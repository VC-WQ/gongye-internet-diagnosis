"""V2.1 写入入口的最小权限与状态机回归；所有设备/阈值操作都在测试替身内。"""
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import Event, SessionLocal
from app.modules.command_loop.models import EventTimeline
from app.modules.feedback.service import feedback_service


def _admin_headers(client):
    response = client.post('/api/v1/auth/login', json={'username': 'admin', 'password': 'admin123'})
    assert response.status_code == 200
    return {'Authorization': f"Bearer {response.json()['token']}"}


def _event(state):
    with SessionLocal() as db:
        event = Event(device_id='pump-001', event_type='diagnosis_event', status_state=state,
                      timestamp=datetime.utcnow(), agent_diagnosis={'report': {'recommendation': '原建议'}})
        db.add(event)
        db.commit()
        db.refresh(event)
        return event.id


def test_feedback_writes_require_login_and_calibration_requires_admin(monkeypatch):
    calls = []
    def collect(db, event_id, feedback):
        calls.append(('feedback', event_id, feedback))
        return {'status': 'collected'}
    def calibrate(db, device_id):
        calls.append(('calibrate', device_id))
        return {'device_id': device_id, 'generated': 0, 'suggestions': []}
    monkeypatch.setattr(feedback_service, 'collect_feedback', collect)
    monkeypatch.setattr(feedback_service, 'calibrate', calibrate)
    with TestClient(app) as client:
        assert client.post('/api/v1/feedback/1', json={}).status_code == 401
        assert client.post('/api/v1/feedback/device/pump-001/calibrate').status_code == 401
        assert calls == []
        registration = client.post('/api/v1/auth/register', json={'username': 'v21_feedback_operator', 'password': 'isolated-test-123'})
        assert registration.status_code == 200
        headers = {'Authorization': f"Bearer {registration.json()['token']}"}
        assert client.post('/api/v1/feedback/device/pump-001/calibrate', headers=headers).status_code == 403
        assert calls == []
        assert client.post('/api/v1/feedback/1', headers=headers, json={'operator': 'forged-admin', 'correct': True}).status_code == 200
        assert calls == [('feedback', 1, {'operator': 'v21_feedback_operator', 'correct': True})]
        assert client.post('/api/v1/feedback/device/pump-001/calibrate', headers=_admin_headers(client)).status_code == 200
        assert calls[-1] == ('calibrate', 'pump-001')


@pytest.mark.parametrize('state', ['normal', 'warning', 'alarm', 'consulting', 'handling', 'observing', 'recovered', 'relapsed'])
def test_revision_rejects_nonpending_events_without_mutating_report(state):
    with TestClient(app) as client:
        event_id = _event(state)
        response = client.post(f'/api/v1/command-loop/events/{event_id}/revise', headers=_admin_headers(client),
                               json={'operator': 'forged', 'recommendation': '不应保存', 'note': 'test'})
        assert response.status_code == 400
        with SessionLocal() as db:
            event = db.get(Event, event_id)
            assert event.status_state == state
            assert event.agent_diagnosis == {'report': {'recommendation': '原建议'}}
            assert db.query(EventTimeline).filter_by(event_id=event_id).count() == 0


def test_pending_revision_keeps_state_and_records_authenticated_identity():
    with TestClient(app) as client:
        event_id = _event('pending')
        endpoint = f'/api/v1/command-loop/events/{event_id}/revise'
        body = {'operator': 'forged', 'recommendation': '新的待确认建议', 'note': '现场复核'}
        assert client.post(endpoint, json=body).status_code == 401
        response = client.post(endpoint, headers=_admin_headers(client), json=body)
        assert response.status_code == 200
        with SessionLocal() as db:
            event = db.get(Event, event_id)
            assert event.status_state == 'pending'
            assert event.agent_diagnosis['report']['recommendation'] == '新的待确认建议'
            assert event.agent_diagnosis['human_revision']['operator'] == 'admin'
            timeline = db.query(EventTimeline).filter_by(event_id=event_id).one()
            assert timeline.operator == 'admin'
            assert timeline.from_state == timeline.to_state == 'pending'


def test_threshold_decisions_require_admin_and_use_server_identity(monkeypatch):
    from app.modules.command_loop.threshold_adapter import threshold_adapter
    calls=[]
    monkeypatch.setattr(threshold_adapter,'accept',lambda db,sid,who: calls.append(('accept',sid,who)) or {'id':sid})
    monkeypatch.setattr(threshold_adapter,'reject',lambda db,sid,who: calls.append(('reject',sid,who)) or {'id':sid})
    with TestClient(app) as client:
        body={'operator':'forged-admin'}
        assert client.post('/api/v1/threshold/suggestions/1/accept',json=body).status_code==401
        registration=client.post('/api/v1/auth/register',json={'username':'v21_threshold_reader','password':'isolated-test-123'})
        headers={'Authorization':f"Bearer {registration.json()['token']}"}
        for action in ['accept','reject']:
            assert client.post(f'/api/v1/threshold/suggestions/1/{action}',headers=headers,json=body).status_code==403
        assert calls==[]
        for action in ['accept','reject']:
            assert client.post(f'/api/v1/threshold/suggestions/1/{action}',headers=_admin_headers(client),json=body).status_code==200
        assert calls==[('accept',1,'admin'),('reject',1,'admin')]


def test_threshold_history_and_effects_require_login_before_service_access(monkeypatch):
    from app.modules.threshold.service import threshold_effect_service
    calls = []
    monkeypatch.setattr(threshold_effect_service, 'list_effects',
                        lambda *args: calls.append('list') or [])
    monkeypatch.setattr(threshold_effect_service, 'compute_effect',
                        lambda *args: calls.append('effect') or {})
    monkeypatch.setattr(threshold_effect_service, 'history',
                        lambda *args: calls.append('history') or {})
    paths = ['/api/v1/threshold/effects', '/api/v1/threshold/effects/1',
             '/api/v1/threshold/history/pump-001']
    with TestClient(app) as client:
        for path in paths:
            assert client.get(path).status_code == 401
        assert calls == []
        for path in paths:
            assert client.get(path, headers=_admin_headers(client)).status_code == 200
        assert calls == ['list', 'effect', 'history']
