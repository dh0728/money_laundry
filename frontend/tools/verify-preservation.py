#!/usr/bin/env python3
"""Read-only verification of an AML frontend preservation bundle and optional peer."""
from pathlib import Path
from html.parser import HTMLParser
import argparse, hashlib, json, posixpath, re, sys, urllib.parse, xml.etree.ElementTree as ET

def digest(data):
    return hashlib.sha256(data).hexdigest()

class LocalLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.targets=[]
    def handle_starttag(self,tag,attrs):
        for name,value in attrs:
            if value and name in {'src','href','data'}:
                parsed=urllib.parse.urlsplit(value)
                if not parsed.scheme and not parsed.netloc and parsed.path:
                    self.targets.append(urllib.parse.unquote(parsed.path))

def check(root,peer=None):
    root=root.resolve()
    manifest_path=root/'preservation-manifest.json'
    manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    errors=[]
    files=manifest['files']
    paths={r['path'] for r in files}
    if len(paths)!=len(files):errors.append('duplicate manifest path')
    if peer and manifest_path.read_bytes()!=(peer/'preservation-manifest.json').read_bytes():
        errors.append('peer manifest differs')
    svg=0;html_count=0
    for row in files:
        rel=Path(row['path'])
        if rel.is_absolute() or '..' in rel.parts:
            errors.append('unsafe path '+str(rel));continue
        if any(x in rel.parts for x in ['node_modules','dist','.git','.vite','__pycache__']):
            errors.append('cache/runtime path in preservation manifest '+str(rel))
        if rel.name.startswith('.env') and not rel.name.endswith('.example'):
            errors.append('environment file in preservation manifest '+str(rel))
        p=root/rel
        if not p.is_file():errors.append('missing '+str(rel));continue
        data=p.read_bytes()
        if len(data)!=row['bytes'] or digest(data)!=row['sha256']:errors.append('hash mismatch '+str(rel))
        if peer:
            target=peer/rel
            if not target.is_file() or target.read_bytes()!=data:errors.append('peer file differs '+str(rel))
        if p.suffix=='.svg':
            svg+=1
            try:ET.fromstring(data)
            except ET.ParseError:errors.append('invalid SVG '+str(rel))
        if p.suffix=='.html':html_count+=1
    versions=json.loads((root/'versions.json').read_text(encoding='utf-8'))
    expected={f'0.{n}.0' for n in range(1,25)}|{'1.0.0','2.0.0'}
    if {v['version'] for v in versions['versions']}!=expected:errors.append('version matrix incomplete')
    generated=[]
    for version in versions['versions']:
        for field in ['version_record','verification']:
            if version[field] not in paths:errors.append('version record missing '+version[field])
        for field in ['source_files','original_html','entry_html','generated_html','related_design']:
            for rel in version[field]:
                if rel not in paths:errors.append('matrix target missing '+rel)
        generated+=version['generated_html']
        if version['version']=='2.0.0' and any(version[field] for field in ['source_files','original_html','entry_html','generated_html']):
            errors.append('invented 2.0.0 design artifact')
        if not version.get('source') or not version.get('run'):errors.append('missing provenance/run record')
    # Validate locally generated viewers/build links. Historical compiled HTML is opaque,
    # retained byte-for-byte; embedded bundle strings are not interpreted as file links.
    generated_link_count=0
    for rel in generated:
        parser=LocalLinks();parser.feed((root/rel).read_text(encoding='utf-8'))
        for link in parser.targets:
            generated_link_count+=1
            if link.startswith('/'):
                errors.append('absolute link in portable generated HTML '+rel+': '+link);continue
            target=(root/rel).parent/link
            if not target.is_file():errors.append('broken generated HTML link '+rel+': '+link)
    if peer:
        # The new archive bundle has no pre-existing runtime/cache files; require exact inventory.
        observed={str(p.relative_to(peer)) for p in peer.rglob('*') if p.is_file()}
        extras=observed-paths-{'preservation-manifest.json'}
        if extras:errors.append('unmanifested peer files: '+', '.join(sorted(extras)[:10]))
    result={'root':str(root),'peer':str(peer) if peer else None,'versions':len(versions['versions']),'files':len(files)+1,'html_files':html_count,'svg_files':svg,'generated_HTML':len(generated),'generated_local_links_checked':generated_link_count,'manifest_sha256':digest(manifest_path.read_bytes()),'errors':errors}
    print(json.dumps(result,ensure_ascii=False))
    return not errors

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('frontend',type=Path)
    parser.add_argument('peer_frontend',type=Path,nargs='?')
    args=parser.parse_args()
    sys.exit(0 if check(args.frontend,args.peer_frontend.resolve() if args.peer_frontend else None) else 1)
