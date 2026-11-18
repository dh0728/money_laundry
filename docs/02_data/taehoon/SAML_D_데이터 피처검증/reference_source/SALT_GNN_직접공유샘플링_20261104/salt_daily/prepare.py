"""Build the full-population index without starting training."""
from .config import ROOT
from .storage import read_json, write_json, sha
from .population import prepare_population


def prepare():
    protocol = read_json(ROOT/'protocol.json')
    assert protocol['version'] == 'salt-daily-direct-shared-equivalent-v1'
    for name, digest in protocol['source_manifest'].items():
        assert sha(name) == digest, f'Input source changed: {name}'
    population = prepare_population()
    cohorts = population['cohorts']
    if protocol['cohorts'] != cohorts:
        assert not (ROOT/'runs/daily_close_001/models').exists(), 'Cannot change an existing training population'
        protocol['cohorts'] = cohorts
        protocol['training']['updates_per_full_epoch'] = sum(
            (s['stop']-s['start']+protocol['training']['logical_batch']-1)//protocol['training']['logical_batch']
            for s in cohorts['train_gnn']['spans'])
        protocol['population_manifest_sha256'] = sha(ROOT/'cache/population/population.json')
        write_json(ROOT/'protocol.json', protocol)
    return protocol
