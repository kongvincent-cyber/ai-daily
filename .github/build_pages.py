"""Build a smaller Pages artifact; repository history and source bytes stay intact."""
import hashlib,json,pathlib,shutil,subprocess
root=pathlib.Path('.').resolve()
out=root/'_site'
if out.exists(): raise SystemExit('Fresh output directory required')
retained=json.loads((root/'.github/pages-retained-reports.json').read_text())
reports=json.loads((root/'reports/manifest.json').read_text())['reports']
proof={r['path']:r['sha256'] for r in retained+reports}
for name,expected in proof.items():
    if not name.startswith('reports/') or '/' in name[len('reports/'):] or not name.endswith('.enc'):
        raise SystemExit('Unsafe report dependency: '+name)
    if hashlib.sha256((root/name).read_bytes()).hexdigest()!=expected:
        raise SystemExit('Report hash differs: '+name)
tracked=subprocess.check_output(['git','ls-files','-z']).decode().split('\0')
copied={};omitted=[]
for name in sorted(filter(None,tracked)):
    path=root/name
    if name.startswith('.github/') or name=='README.md': continue
    if path.is_symlink() or not path.is_file(): raise SystemExit('Unexpected source type: '+name)
    if name.startswith('reports/') and name.endswith('.enc') and name not in proof:
        omitted.append(name);continue
    target=out/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(path,target)
    copied[name]=hashlib.sha256(target.read_bytes()).hexdigest()
for name in ['index.html','latest.enc','manifest.json','history.enc','series.enc','live_baseline.enc',*proof]:
    if name not in copied: raise SystemExit('Missing deployment dependency: '+name)
manifest=json.loads((out/'manifest.json').read_text())
for day in manifest['dates']:
    if 'data/'+day+'.enc' not in copied: raise SystemExit('Missing historical snapshot: '+day)
result={'source_commit':subprocess.check_output(['git','rev-parse','HEAD']).decode().strip(),
        'files':len(copied),'bytes':sum((out/p).stat().st_size for p in copied),
        'retained_report_count':len(proof),'historical_snapshots':len(manifest['dates']),
        'omitted_superseded_reports':omitted,'sha256':copied}
(root/'pages-build-proof.json').write_text(json.dumps(result,indent=2))
print(json.dumps({k:v for k,v in result.items() if k not in ('sha256','omitted_superseded_reports')}))
