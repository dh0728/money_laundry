"""Demo-only lookup through frozen report IDs; never a real-model feature source."""
from demo_calculator import (MODEL_VERSION, FEATURE_VERSION, LABEL_MODEL_VERSION,
                             LABEL_FEATURE_VERSION, build_label_targets, supported_versions)
from frozen_input import FrozenInput
from worker_transport import ProtocolError


def versions_for_run(connection, execution):
    stored = connection.execute('SELECT binding FROM analysis_model_tasks WHERE run_id=%s',
                                (execution.run_id,)).fetchall()
    if stored:
        versions = {(r[0].get('model_version'), r[0].get('feature_version')) for r in stored}
        if len(versions) != 1 or not supported_versions(*next(iter(versions))):
            raise ProtocolError('Conflicting or unsupported stored model versions')
        return next(iter(versions))
    total, annotated = connection.execute('''
        SELECT count(*), count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM analysis_input_reports r JOIN evaluation.demo_report_hints h USING(report_id)
          WHERE r.run_id=i.run_id AND r.tx_id=i.tx_id))
        FROM analysis.input_transactions i WHERE run_id=%s AND input_role='TARGET'
        ''', (execution.run_id,)).fetchone()
    if annotated and annotated != total:
        raise ProtocolError('Mixed annotated and unannotated demo input')
    return (LABEL_MODEL_VERSION, LABEL_FEATURE_VERSION) if annotated else (MODEL_VERSION, FEATURE_VERSION)


class DemoLabelInput(FrozenInput):
    def batches(self):
        after = 0
        while True:
            ids = self._page(after)
            if not ids:
                return
            rows = self.connection.execute('''
                SELECT r.tx_id,h.dataset_version,h.is_laundering,h.type_code
                FROM analysis_input_reports r LEFT JOIN evaluation.demo_report_hints h USING(report_id)
                WHERE r.run_id=%s AND r.tx_id=ANY(%s)
                ''', (self.execution.run_id, ids)).fetchall()
            hints = {}
            for tx_id, version, label, kind in rows:
                if version != 'pattern5-2023-v1' or label is None or kind is None:
                    raise ProtocolError('Missing demo report annotation')
                value = (label, kind)
                if tx_id in hints and hints[tx_id] != value:
                    raise ProtocolError('Conflicting demo report annotations')
                hints[tx_id] = value
            if set(hints) != set(ids):
                raise ProtocolError('Missing demo TARGET annotation')
            self.check_current()
            yield build_label_targets([(i, *hints[i]) for i in ids])
            after = ids[-1]
