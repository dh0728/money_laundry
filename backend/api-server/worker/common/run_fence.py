"""Run-ownership fence and stage checkpoint shared by the INFERENCE, SCORES and ALERTS stages."""
from common.frozen_input import StaleExecution


def lock_stage(connection, execution, stage='INFERENCE'):
    connection.execute('SELECT pg_advisory_xact_lock(17004000)')
    connection.execute('SELECT job_id FROM analysis.jobs WHERE job_id=%s FOR UPDATE', (execution.job_id,))
    connection.execute('SELECT run_id FROM analysis.runs WHERE run_id=%s FOR UPDATE', (execution.run_id,))
    row = connection.execute('''
        SELECT b.execution_id,b.status,b.current_stage,b.current_run_id,r.status
        FROM analysis.jobs b LEFT JOIN analysis.runs r ON r.run_id=b.current_run_id WHERE b.job_id=%s
        ''', (execution.job_id,)).fetchone()
    if row != (execution.execution_id, 'RUNNING', stage, execution.run_id, 'READY') and row != (
            execution.execution_id, 'RUNNING', stage, execution.run_id, 'ACTIVE'):
        raise StaleExecution('Worker owner is no longer current')
    blocked = connection.execute('''
        WITH RECURSIVE predecessors(run_id) AS (
          SELECT replaces_run_id FROM analysis.run_replacements WHERE run_id=%s
          UNION SELECT x.replaces_run_id FROM analysis.run_replacements x JOIN predecessors p ON x.run_id=p.run_id)
        SELECT EXISTS(SELECT 1 FROM analysis.model_requests m JOIN predecessors p USING(run_id)
          WHERE m.status NOT IN ('STOPPED','ALREADY_FINISHED','BLOCKED'))
        ''', (execution.run_id,)).fetchone()[0]
    if blocked:
        raise StaleExecution('Previous run has not stopped')


def save_checkpoint(connection, execution, stage, artifact):
    connection.execute('''INSERT INTO analysis.stage_results(job_id,run_id,stage,execution_id,artifact,completed)
        VALUES(%s,%s,%s,%s,%s,true) ON CONFLICT(job_id,stage) DO UPDATE SET
          run_id=excluded.run_id,execution_id=excluded.execution_id,artifact=excluded.artifact,completed=true''',
        (execution.job_id, execution.run_id, stage, execution.execution_id, artifact))
