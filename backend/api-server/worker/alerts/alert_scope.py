"""What one ALERTS run reads: the new-seed scope (alert_new_seed_design_20261022.md §3).

Alerts start from the run's new seeds. A run reads the frozen input of a fixed window before
its earliest TARGET (WINDOW_DAYS), groups only seeds from SPAN after the window start (so their
blocks fit inside it), pins the OPEN Alerts reaching into that seed range, and plans only the
Alerts its graphs touch plus those whose member facts changed since the previous completed run.
Everything is derived from the run's frozen input, so a retry reads the same scope.

The window comes from the ledger's active-time index (ledger.transactions occurred_at); the
values are the run's frozen versions (its own rows, or input_ledger at its input_seq).
"""
from datetime import timedelta

from alerts.block_graph import BlockPolicy

WINDOW_DAYS = 60
SPAN = timedelta(microseconds=BlockPolicy().span_max_us)

_WINDOW_IDS = """ids AS (SELECT tx_id FROM ledger.transactions
    WHERE integration_status='ACTIVE' AND occurred_at>=%(start)s)"""

INPUT_ROWS = """WITH """ + _WINDOW_IDS + """, own AS (
      SELECT tx_id,input_role,occurred_at,from_bank_id,from_account_id,to_bank_id,to_account_id,amount_usd
      FROM analysis.input_transactions WHERE run_id=%(run)s AND occurred_at>=%(start)s)
    SELECT * FROM own
    UNION ALL
    SELECT l.tx_id,'CONTEXT',l.occurred_at,l.from_bank_id,l.from_account_id,l.to_bank_id,l.to_account_id,l.amount_usd
    FROM ids JOIN analysis.input_ledger l USING(tx_id)
    WHERE l.valid_from_seq<=%(seq)s AND (l.valid_to_seq IS NULL OR l.valid_to_seq>%(seq)s)
      AND l.occurred_at>=%(start)s AND NOT EXISTS(SELECT 1 FROM own o WHERE o.tx_id=l.tx_id)
    ORDER BY tx_id"""

# Frozen score decisions of the window (p_laundering as stored jsonb, threshold of the scoring job).
WINDOW_SCORES = """WITH """ + _WINDOW_IDS + """
    SELECT l.tx_id,to_jsonb(s.p_laundering),b.threshold_value
    FROM ids JOIN analysis.score_ledger l USING(tx_id)
    JOIN analysis.scores s ON s.run_id=l.score_run_id AND s.tx_id=l.tx_id
    JOIN analysis.runs r ON r.run_id=l.score_run_id JOIN analysis.jobs b ON b.job_id=r.job_id
    WHERE l.valid_from_seq<=%(seq)s AND (l.valid_to_seq IS NULL OR l.valid_to_seq>%(seq)s)"""


class Scope:
    """The run's window: input start, seed start, its ledger position and the previous one."""

    def __init__(self, connection, run_id):
        self.run_id = run_id
        self.seq, cutoff = connection.execute(
            '''SELECT r.input_seq,b.analysis_cutoff_at FROM analysis.runs r JOIN analysis.jobs b USING(job_id)
               WHERE r.run_id=%s''', (run_id,)).fetchone()
        earliest = connection.execute(
            "SELECT min(occurred_at) FROM analysis.input_transactions WHERE run_id=%s AND input_role='TARGET'",
            (run_id,)).fetchone()[0]
        self.start = (earliest or cutoff) - timedelta(days=WINDOW_DAYS)
        self.seed_start = self.start + SPAN
        self.previous_seq = connection.execute(
            '''SELECT max(input_seq) FROM analysis.runs WHERE status='COMPLETED' AND input_seq<%s''',
            (self.seq,)).fetchone()[0] if self.seq is not None else None

    def arguments(self):
        return dict(run=self.run_id, start=self.start, seq=self.seq)

    def pinned(self, connection):
        """OPEN Alerts whose published evidence reaches the seed range, with that evidence."""
        return connection.execute('''SELECT o.alert_id,v.evidence->'seeds',
            (SELECT jsonb_agg(t->'txId') FROM jsonb_array_elements(v.evidence->'transactions') t
             WHERE t->>'role'<>'CONTEXT'),
            (SELECT jsonb_agg(t->'txId') FROM jsonb_array_elements(v.evidence->'transactions') t),
            coalesce(v.evidence->'witnesses','[]'::jsonb), v.evidence->>'policyVersion'
            FROM analysis.run_alert_origins o JOIN review.alerts a USING(alert_id)
            JOIN review.alert_versions v ON v.alert_id=o.alert_id AND v.version=o.version
            WHERE o.run_id=%s AND a.status='OPEN' AND a.merged_into_alert_id IS NULL
              AND (v.evidence->'summary'->>'lastTxAt' IS NULL
                   OR (v.evidence->'summary'->>'lastTxAt')::timestamptz>=%s)
            ORDER BY o.alert_id''', (self.run_id, self.seed_start)).fetchall()

    def owned_elsewhere(self, connection, seed_ids, pinned_ids):
        """Seeds among seed_ids that an OPEN Alert outside the pinned set owns."""
        if not seed_ids:
            return set()
        return {key for key, in connection.execute('''SELECT DISTINCT m.tx_id
            FROM review.alert_transactions m
            JOIN analysis.run_alert_origins o ON o.alert_id=m.alert_id AND o.version=m.version AND o.run_id=%s
            JOIN review.alerts a ON a.alert_id=m.alert_id
            WHERE m.tx_id=ANY(%s) AND m.role='SEED' AND a.status='OPEN' AND a.merged_into_alert_id IS NULL
              AND NOT m.alert_id=ANY(%s)''', (self.run_id, sorted(seed_ids), sorted(pinned_ids)))}

    def planned(self, connection, pinned_ids, core_ids):
        """Alerts to plan: pinned ones, Alerts owning a seed in the graphs' cores, OPEN Alerts with
        a member whose input or facts changed since the previous completed run, then their
        follow-up ancestors and merge aliases (the lifecycle validates both)."""
        chosen = set(pinned_ids)
        if core_ids:
            chosen.update(key for key, in connection.execute('''SELECT DISTINCT m.alert_id
                FROM review.alert_transactions m
                JOIN analysis.run_alert_origins o ON o.alert_id=m.alert_id AND o.version=m.version AND o.run_id=%s
                WHERE m.tx_id=ANY(%s) AND m.role='SEED' ''', (self.run_id, sorted(core_ids))))
        if self.previous_seq is not None:
            chosen.update(key for key, in connection.execute('''WITH changed AS (
                  SELECT tx_id FROM analysis.input_ledger WHERE valid_from_seq>%(prev)s AND valid_from_seq<=%(seq)s
                  UNION SELECT tx_id FROM analysis.input_ledger WHERE valid_to_seq>%(prev)s AND valid_to_seq<=%(seq)s
                  UNION SELECT tx_id FROM analysis.fact_ledger WHERE valid_from_seq>%(prev)s AND valid_from_seq<=%(seq)s)
                SELECT DISTINCT m.alert_id FROM changed c JOIN review.alert_transactions m USING(tx_id)
                JOIN analysis.run_alert_origins o ON o.alert_id=m.alert_id AND o.version=m.version AND o.run_id=%(run)s
                JOIN review.alerts a ON a.alert_id=m.alert_id WHERE a.status='OPEN' ''',
                dict(prev=self.previous_seq, seq=self.seq, run=self.run_id)))
        while True:
            before = len(chosen)
            ids = sorted(chosen)
            chosen.update(key for key, in connection.execute('''WITH RECURSIVE ancestry(alert_id) AS (
                  SELECT target_alert_id FROM review.alert_lineage WHERE kind='FOLLOWUP_OF' AND source_alert_id=ANY(%s)
                  UNION SELECT l.target_alert_id FROM ancestry a JOIN review.alert_lineage l
                    ON l.source_alert_id=a.alert_id AND l.kind='FOLLOWUP_OF')
                SELECT alert_id FROM ancestry''', (ids,)))
            chosen.update(key for key, in connection.execute(
                '''SELECT alert_id FROM review.alerts WHERE merged_into_alert_id=ANY(%s)
                   UNION SELECT merged_into_alert_id FROM review.alerts
                   WHERE alert_id=ANY(%s) AND merged_into_alert_id IS NOT NULL''', (ids, ids)))
            if len(chosen) == before:
                return chosen
