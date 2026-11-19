"""Small stdlib tests for plan integrity, RAM/model policy and fail-closed import.
All import CLI responses below are explicitly simulated fixtures, NOT cloud evidence.
"""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('fluid_music_plan_import',HERE/'import_kanban.py')
imp=importlib.util.module_from_spec(spec)
spec.loader.exec_module(imp)
MODEL='qwen/qwen4-max:free'
FIXTURE_PROVIDER='fixture-provider-not-a-live-route'

def fixture_config():
    return {'model':{'provider':FIXTURE_PROVIDER,'default':MODEL},'delegation':{'model':MODEL,'provider':FIXTURE_PROVIDER}}

class HandoffChecks(unittest.TestCase):
    def test_complete_manifest_preserved_source_and_policy(self):
        manifest=imp.validate(HERE)
        self.assertEqual(len(manifest['cards']),26)
        self.assertEqual(len(manifest['original_task_ids']),40)
        self.assertTrue(manifest['delegation_allowed'])
        self.assertFalse(manifest['testing_policy']['docker_allowed'])
        self.assertFalse(manifest['testing_policy']['heavyweight_test_stacks_allowed'])
        self.assertFalse(manifest['testing_policy']['parallel_heavy_checks_allowed'])
        for card in manifest['cards']:
            body=(HERE/card['body_file']).read_text(encoding='utf-8')
            for required in ['qwen/qwen4-max:free','Every delegated worker MUST also use','NO Docker','SQLite','CALLBACK START','CALLBACK FINISH','PUSH','## Concrete acceptance scenarios','## Required completion receipt','FluidMusic']:
                self.assertIn(required,body,card['key'])
        # Genuine read-only Git/source validation, not a simulated fixture.
        imp.verify_workspace(HERE.parents[2],manifest)

    def test_unsafe_path_and_tampered_body_are_rejected(self):
        with self.assertRaises(ValueError):
            imp.safe_path(HERE,'../outside.md')
        with tempfile.TemporaryDirectory(prefix='fluid-plan-test-',dir=os.environ.get('TMPDIR')) as tmp:
            root=Path(tmp)
            shutil.copy2(HERE/'manifest.json',root/'manifest.json')
            shutil.copy2(HERE/'MASTER_PLAN.md',root/'MASTER_PLAN.md')
            (root/'kanban').mkdir()
            (root/'kanban/FM-00.md').write_text('INTENTIONALLY TAMPERED TEST FIXTURE',encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'body hash mismatch'):
                imp.validate(root)

    def test_exact_primary_child_model_and_no_fallback(self):
        self.assertEqual(imp.profile_route(fixture_config()),FIXTURE_PROVIDER)
        inherited=fixture_config()
        inherited.pop('delegation')
        self.assertEqual(imp.profile_route(inherited),FIXTURE_PROVIDER)
        for section,field,bad in [('model','default','qwen/qwen4-max'),('delegation','model','some-other-model'),('delegation','provider','another-provider'),('model','fallback_models',['another-model'])]:
            changed=fixture_config()
            changed[section][field]=bad
            with self.subTest(section=section,field=field),self.assertRaises(ValueError):
                imp.profile_route(changed)

    def test_readback_rejects_route_body_parent_and_run_drift(self):
        card={'key':'FM-00'}
        expected={'task':{'id':'fixture-not-a-live-task','status':'blocked','assignee':'fixture-profile','body':'exact body','provider_override':FIXTURE_PROVIDER,'model_override':MODEL,'current_run_id':None,'started_at':None},'parents':[],'runs':[]}
        def check(value,parents=None):
            return imp.verify_task(value,card,'fixture-profile','exact body',parents or [],FIXTURE_PROVIDER)
        check(expected)
        for field,bad in [('status','ready'),('body','truncated'),('model_override','another-model'),('provider_override','another-provider'),('current_run_id','fixture-run')]:
            changed=copy.deepcopy(expected)
            changed['task'][field]=bad
            with self.subTest(field=field),self.assertRaises(ValueError):
                check(changed)
        for field,bad in [('parents',['fixture-wrong-parent']),('runs',[{'id':'fixture-unexpected-run'}])]:
            changed=copy.deepcopy(expected)
            changed[field]=bad
            with self.subTest(field=field),self.assertRaises(ValueError):
                check(changed)
        changed=copy.deepcopy(expected)
        changed.pop('runs')
        with self.assertRaises(ValueError):
            check(changed)

    def test_dry_run_has_zero_commands_or_writes(self):
        output=io.StringIO()
        with patch.object(imp.subprocess,'run',side_effect=AssertionError('Unexpected command')),patch.object(imp.subprocess,'check_output',side_effect=AssertionError('Unexpected command')),contextlib.redirect_stdout(output):
            self.assertEqual(imp.main([]),0)
        result=json.loads(output.getvalue())
        self.assertEqual(result['writes'],0)
        self.assertFalse(result['workers_started'])
        self.assertEqual(result['primary_model'],MODEL)
        self.assertEqual(result['delegation_model'],MODEL)

    def test_full_import_control_flow_with_explicit_mock_cli(self):
        # Exercise all 26 create + 52 show calls without a real board/profile/service.
        calls=[]
        records={}
        def fake_cli(cli,board,args,cwd):
            calls.append(list(args))
            if args[0]=='create':
                def value(flag):return args[args.index(flag)+1]
                self.assertEqual(value('--initial-status'),'blocked')
                self.assertEqual(value('--provider'),FIXTURE_PROVIDER)
                self.assertEqual(value('--model'),MODEL)
                tid='fixture-task-'+str(len(records))+'-not-live'
                parents=[args[i+1] for i,arg in enumerate(args) if arg=='--parent']
                records[tid]={'task':{'id':tid,'assignee':value('--assignee'),'status':'blocked','provider_override':FIXTURE_PROVIDER,'model_override':MODEL,'body':Path(value('--body-file')).read_text(encoding='utf-8'),'started_at':None,'current_run_id':None},'parents':parents,'runs':[]}
                return {'task':copy.deepcopy(records[tid]['task'])}
            self.assertEqual(args[0],'show')
            return copy.deepcopy(records[args[1]])
        with tempfile.TemporaryDirectory(prefix='fluid-import-fixture-',dir=os.environ.get('TMPDIR')) as tmp:
            root=Path(tmp)
            cfg=root/'fixture-profile.json'
            cfg.write_text(json.dumps(fixture_config()),encoding='utf-8')
            receipt=root/'fixture-receipt.json'
            argv=['--apply','--board','fixture-board-not-live','--assignee','fixture-profile','--workspace',str(root),'--profile-config',str(cfg),'--confirm-repository',imp.REPOSITORY,'--receipt',str(receipt)]
            mock_help=types.SimpleNamespace(returncode=0,stdout='--body-file --initial-status --model --provider')
            # JSON subset is valid YAML; parsing is stubbed solely to keep tests stdlib-only.
            with patch.dict(sys.modules,{'yaml':types.SimpleNamespace(safe_load=json.loads)}),patch.object(imp,'verify_workspace'),patch.object(imp.shutil,'which',return_value='fixture-command'),patch.object(imp.subprocess,'run',return_value=mock_help),patch.object(imp,'cli_json',side_effect=fake_cli),contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(imp.main(argv),0)
            result=json.loads(receipt.read_text(encoding='utf-8'))
            self.assertEqual(len(result['cards']),26)
            self.assertTrue(result['all_blocked_verified'])
            self.assertTrue(result['zero_runs_verified'])
            self.assertFalse(result['started_workers'])
            self.assertTrue(all(c['verified'] for c in result['cards']))
        self.assertEqual(sum(c[0]=='create' for c in calls),26)
        self.assertEqual(sum(c[0]=='show' for c in calls),52)
        self.assertEqual({c[0] for c in calls},{'create','show'})

if __name__=='__main__':
    unittest.main()
