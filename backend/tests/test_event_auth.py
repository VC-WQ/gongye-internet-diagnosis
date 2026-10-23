"""Event writes use authenticated identity and cannot bypass force protection."""
from fastapi.testclient import TestClient
from app.main import app
from app.modules.command_loop.service import command_loop_service


def test_event_routes_reject_anonymous_writes():
    with TestClient(app) as client:
        for suffix, body in [("", {"device_id":"pump-001","window":[]}), ("/1/confirm", {"operator":"admin"}), ("/1/execute", {"operator":"admin"}), ("/1/observe", {"actual_curve":[1,2,3]})]:
            assert client.post('/api/v1/command-loop/events'+suffix, json=body).status_code == 401


def test_event_operator_is_authenticated_user_and_force_requires_admin(monkeypatch):
    with TestClient(app) as client:
        response = client.post('/api/v1/auth/register', json={"username":"v21_operator","password":"isolated-test-123"})
        assert response.status_code == 200
        headers={"Authorization":f"Bearer {response.json()['token']}"}
        assert client.post('/api/v1/command-loop/events', headers=headers, json={"device_id":"pump-001","window":[],"force":True}).status_code == 403
        called=[]
        def confirm(db, eid, operator):
            called.append((eid,operator));return {"id":eid,"status_state":"handling"}
        monkeypatch.setattr(command_loop_service,'confirm',confirm)
        response=client.post('/api/v1/command-loop/events/1/confirm',headers=headers,json={"operator":"forged-admin"})
        assert response.status_code == 200
        assert called == [(1, 'v21_operator')]


def test_observation_requires_three_samples_and_preserves_state_machine(monkeypatch):
    from datetime import datetime
    from app.models import Device, Event, SessionLocal
    from app.modules.command_loop.models import CommandRecord
    from app.modules.command_loop.mqtt_publisher import mqtt_command_publisher
    with TestClient(app) as client:
        token=client.post('/api/v1/auth/login',json={"username":"admin","password":"admin123"}).json()['token']
        headers={"Authorization":f"Bearer {token}"}
        with SessionLocal() as db:
            event=Event(device_id='pump-002',event_type='diagnosis_event',status_state='pending',timestamp=datetime.utcnow(),agent_diagnosis={'report':{'recommendation':'sandbox only'}})
            db.add(event);db.commit();db.refresh(event);eid=event.id
        calls=[]
        def publish(*args,**kwargs):
            calls.append(args);return {'command_id':'sandbox-1','topic':'sandbox/test','published':True}
        monkeypatch.setattr(mqtt_command_publisher,'publish_command',publish)
        base=f'/api/v1/command-loop/events/{eid}'
        assert client.post(base+'/execute',headers=headers,json={'operator':'admin'}).status_code == 400
        assert calls == []
        assert client.post(base+'/confirm',headers=headers,json={'operator':'forged'}).status_code == 200
        # 回放模式拒绝下发；自由文本也不允许
        assert client.post(base+'/execute',headers=headers,json={'operator':'forged'}).status_code == 400
        assert calls == []
        with SessionLocal() as db:
            db.get(Device, 'pump-002').run_mode = 'simulation'
            db.commit()
        assert client.post(base+'/execute',headers=headers,json={'operator':'forged','command':'lubricate'}).status_code == 200
        with SessionLocal() as db:
            assert db.query(CommandRecord).filter_by(event_id=eid).one().status == 'sent'
        assert client.post(base+'/observe',headers=headers,json={'actual_curve':[80,85]}).status_code == 422
        response=client.post(base+'/observe',headers=headers,json={'actual_curve':[80,83,85]})
        assert response.status_code == 200
        assert response.json()['status_state'] == 'recovered'
        assert client.post(base+'/observe',headers=headers,json={'actual_curve':[80,83,85]}).status_code == 400
        with SessionLocal() as db:
            db.get(Device, 'pump-002').run_mode = 'public_replay'
            db.commit()
