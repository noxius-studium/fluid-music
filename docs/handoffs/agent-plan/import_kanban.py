#!/usr/bin/env python3
"""Validate FluidMusic's handoff, or explicitly import BLOCKED cards. Never dispatch workers.
Dry-run needs Python only. Apply needs existing Git, Hermes CLI and PyYAML.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parent
REPOSITORY='noxius-studium/fluid-music'
MODEL='qwen/qwen4-max:free'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def safe_path(root,relative):
    path=(root/relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError('Manifest path escapes handoff: '+relative)
    return path

def validate(root=ROOT):
    data=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
    if data['repository']!=REPOSITORY or data['start_workers'] is not False:
        raise ValueError('Wrong repository or unsafe execution setting')
    if data['worker_model']!=MODEL or not data['delegation_allowed'] or data['delegation_model']!=MODEL:
        raise ValueError('Wrong primary/delegation model policy')
    testing=data.get('testing_policy',{})
    if any(testing.get(field) is not False for field in ('docker_allowed','heavyweight_test_stacks_allowed','parallel_heavy_checks_allowed')):
        raise ValueError('Missing/unsafe low-RAM testing policy')
    if digest(safe_path(root,data['specification']).read_bytes())!=data['specification_sha256']:
        raise ValueError('Specification hash mismatch')
    if not all(data.get('git_policy',{}).get(k) is True for k in ('commit_each_slice','push_each_commit','verify_remote_sha','continue_until_done_or_user_review')):
        raise ValueError('Missing commit/push/remote-verification/continuation policy')
    if data.get('callback_policy')!=['START','FINISH','BLOCKED','REVIEW']:
        raise ValueError('Missing callback contract')
    cards=data['cards']
    if [c['key'] for c in cards]!=[f'FM-{i:02}' for i in range(26)]:
        raise ValueError('Expected exact FM-00 through FM-25 sequence')
    expected={f'F{i:02}' for i in range(1,41)}
    if set(data['original_task_ids'])!=expected or {t for c in cards for t in c['source_tasks']}!=expected:
        raise ValueError('Original 40-requirement coverage is incomplete')
    for i,card in enumerate(cards):
        if card['depends_on']!=([cards[i-1]['key']] if i else []):
            raise ValueError('Invalid dependency chain: '+card['key'])
        if card['initial_status']!='blocked' or card['goal_mode'] is not False or not card['per_slice_commit_required'] or not card.get('push_after_every_commit_required'):
            raise ValueError('Unsafe task execution/commit policy: '+card['key'])
        if card['model_override']!=MODEL or card['completion_contract']!='local-only':
            raise ValueError('Wrong card route/completion contract: '+card['key'])
        if digest(safe_path(root,card['body_file']).read_bytes())!=card['body_sha256']:
            raise ValueError('Card body hash mismatch: '+card['key'])
    return data

def profile_route(config):
    route=config.get('model',{})
    if not isinstance(route,dict) or route.get('default')!=MODEL:
        raise ValueError('Actual profile model does not exactly match '+MODEL+'; keep cards blocked, do not repair the identifier or change configuration')
    provider=route.get('provider')
    if not isinstance(provider,str) or not provider.strip() or provider!=provider.strip():
        raise ValueError('Cannot verify actual cloud provider from profile')
    delegation=config.get('delegation') or {}
    if not isinstance(delegation,dict):
        raise ValueError('Unrecognized delegation configuration')
    if delegation.get('model') not in (None,'',MODEL):
        raise ValueError('Delegated model override differs from the approved exact Qwen model')
    if delegation.get('provider') not in (None,'',provider):
        raise ValueError('Delegated provider differs; do not silently change providers')
    for obj in (config,route,delegation):
        if any(obj.get(k) for k in ('fallback','fallbacks','fallback_model','fallback_models','fallback_chain')):
            raise ValueError('Fallback configuration needs explicit resolution; no automatic alternate model')
    if (config.get('moa') or {}).get('enabled'):
        raise ValueError('MoA ensemble is not authorized by permission for Qwen-only delegation')
    return provider

def cli_json(cli,board,args,cwd):
    done=subprocess.run([cli,'kanban','--board',board,*args],cwd=cwd,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=120,check=False)
    if done.returncode:
        raise RuntimeError('Hermes command failed: '+str(args[:2])+'\n'+done.stdout+'\n'+done.stderr)
    decoder=json.JSONDecoder()
    for i,char in enumerate(done.stdout):
        if char not in '{[':
            continue
        try:
            result,end=decoder.raw_decode(done.stdout[i:])
        except json.JSONDecodeError:
            continue
        if isinstance(result,(dict,list)) and not done.stdout[i+end:].strip():
            return result
    raise ValueError('Hermes did not return parseable JSON')

def task_row(result):
    if not isinstance(result,dict):
        raise ValueError('Expected task object')
    return result.get('task',result)

def verify_task(result,card,assignee,body,parents,provider):
    row=task_row(result)
    if row.get('status')!='blocked' or row.get('assignee')!=assignee:
        raise ValueError('Task not blocked or wrong assignee: '+card['key'])
    if row.get('provider_override',row.get('provider'))!=provider or row.get('model_override',row.get('model'))!=MODEL:
        raise ValueError('Persisted primary route mismatch: '+card['key'])
    if row.get('body')!=body:
        raise ValueError('Persisted body differs/truncated: '+card['key'])
    if 'runs' not in result or not isinstance(result['runs'],list):
        raise ValueError('Read-back omitted explicit run history: '+card['key'])
    if row.get('current_run_id') or row.get('started_at') or result['runs']:
        raise ValueError('Task has run history; will not reset it: '+card['key'])
    actual=result.get('parents',row.get('parents'))
    if not isinstance(actual,list):
        raise ValueError('Read-back omitted explicit parents: '+card['key'])
    ids=[p.get('id',p.get('parent_id')) if isinstance(p,dict) else p for p in actual]
    if sorted(ids)!=sorted(parents):
        raise ValueError('Persisted dependency mismatch: '+card['key'])
    return row

def verify_workspace(workspace,data):
    if not workspace.is_absolute() or not workspace.is_dir():
        raise ValueError('Workspace must be an existing absolute receiving-host path')
    check=subprocess.run(['git','-C',str(workspace),'merge-base','--is-ancestor',data['baseline_commit'],'HEAD'],capture_output=True,check=False)
    if check.returncode:
        raise ValueError('Original FluidMusic source baseline is not a workspace ancestor')
    origin=subprocess.check_output(['git','-C',str(workspace),'remote','get-url','origin'],text=True).strip()
    if origin.startswith('git@github.com:'):
        repo=origin[len('git@github.com:'):].removesuffix('.git').rstrip('/')
    else:
        parsed=urlsplit(origin)
        repo=parsed.path.strip('/').removesuffix('.git') if parsed.hostname=='github.com' else ''
    if repo!=REPOSITORY:
        raise ValueError('Workspace origin is not the intended FluidMusic GitHub repository')
    for asset in data['source_assets']:
        actual=subprocess.check_output(['git','-C',str(workspace),'rev-parse',data['baseline_commit']+':'+asset['path']],text=True).strip()
        if actual!=asset['baseline_git_blob']:
            raise ValueError('Baseline source/artwork blob mismatch: '+asset['path'])

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--board')
    parser.add_argument('--assignee',help='Actual verified receiving profile, not its connection/display label')
    parser.add_argument('--workspace',type=Path)
    parser.add_argument('--profile-config',type=Path)
    parser.add_argument('--confirm-repository',choices=[REPOSITORY])
    parser.add_argument('--receipt',type=Path,default=ROOT/'import-receipt.local.json')
    args=parser.parse_args(argv)
    data=validate()
    if not args.apply:
        print(json.dumps({'mode':'dry-run','repository':REPOSITORY,'cards':len(data['cards']),'original_requirements':len(data['original_task_ids']),'primary_model':MODEL,'delegation_allowed':True,'delegation_model':MODEL,'provider':'verify from actual receiving profile','hashes':'verified','initial_status':'blocked','writes':0,'workers_started':False},indent=2))
        return 0
    if not all((args.board,args.assignee,args.workspace,args.profile_config,args.confirm_repository)):
        parser.error('--apply requires board, actual assignee, workspace, profile-config and repository confirmation')
    if not args.profile_config.is_file():
        parser.error('Actual existing receiving profile configuration is required')
    import yaml
    provider=profile_route(yaml.safe_load(args.profile_config.read_text(encoding='utf-8')) or {})
    if not shutil.which('hermes') or not shutil.which('git'):
        raise ValueError('Existing Git and Hermes CLI are required; no installation attempted')
    verify_workspace(args.workspace,data)
    cli=shutil.which('hermes')
    help_result=subprocess.run([cli,'kanban','create','--help'],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=90,check=False)
    if help_result.returncode or not all(flag in help_result.stdout for flag in ('--body-file','--initial-status','--model','--provider')):
        raise ValueError('Receiving CLI lacks the required safe blocked/body-file/pinned-route import contract')
    receipt={'repository':REPOSITORY,'board':args.board,'assignee':args.assignee,'workspace':str(args.workspace),'provider':provider,'model':MODEL,'delegation_model':MODEL,'started_workers':False,'cards':[]}
    resolved={}
    staging=args.receipt.parent/(args.receipt.stem+'-payloads')
    staging.mkdir(parents=True,exist_ok=True)
    def save():
        args.receipt.parent.mkdir(parents=True,exist_ok=True)
        args.receipt.write_bytes((json.dumps(receipt,indent=2)+'\n').encode())
    save()
    for card in data['cards']:
        parents=[resolved[k] for k in card['depends_on']]
        binding=f'\n\n## Verified import binding\nActual assignee: {args.assignee}\nBoard: {args.board}\nWorkspace: {args.workspace}\nWorker provider: {provider}\nWorker model: {MODEL}\nEvery delegated worker must use {MODEL}; verify its actual START route.\nState: BLOCKED. Import authorizes no execution.\n'
        body=safe_path(ROOT,card['body_file']).read_text(encoding='utf-8')+binding
        body_path=staging/(card['key']+'.md')
        body_path.write_bytes(body.encode())
        command=['create',card['key']+' — '+card['title'],'--body-file',str(body_path),'--assignee',args.assignee,'--workspace','dir:'+str(args.workspace),'--tenant','fluid-music-complete-handoff','--priority',str(card['priority']),'--idempotency-key',card['idempotency_key'],'--initial-status','blocked','--provider',provider,'--model',MODEL,'--completion-contract','local-only','--max-runtime',card['max_runtime'],'--max-retries',str(card['max_retries']),'--json']
        for parent in parents:
            command.extend(['--parent',parent])
        created=cli_json(cli,args.board,command,args.workspace)
        task_id=task_row(created).get('id') or created.get('task_id')
        if not task_id:
            raise ValueError('Create response omitted task ID: '+card['key'])
        resolved[card['key']]=task_id
        entry={'key':card['key'],'id':task_id,'body_sha256':digest(body.encode()),'verified':False}
        receipt['cards'].append(entry)
        save()
        shown=cli_json(cli,args.board,['show',task_id,'--json'],args.workspace)
        verify_task(shown,card,args.assignee,body,parents,provider)
        entry['verified']=True
        save()
    for card,entry in zip(data['cards'],receipt['cards']):
        body=(staging/(card['key']+'.md')).read_text(encoding='utf-8')
        verify_task(cli_json(cli,args.board,['show',entry['id'],'--json'],args.workspace),card,args.assignee,body,[resolved[k] for k in card['depends_on']],provider)
    receipt['all_blocked_verified']=True
    receipt['zero_runs_verified']=True
    save()
    print(json.dumps(receipt,indent=2))
    return 0

if __name__=='__main__':
    try:
        raise SystemExit(main())
    except (ValueError,TypeError,RuntimeError,OSError,subprocess.SubprocessError) as error:
        print('Import stopped safely: '+str(error),file=sys.stderr)
        raise SystemExit(1)
