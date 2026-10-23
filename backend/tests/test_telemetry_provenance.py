from app.modules.mqtt_pipeline.service import MQTTPipelineService


def test_declared_simulation_provenance_survives_normalization():
    service = MQTTPipelineService()
    service.handle_message('sandbox-001', {'timestamp': 123, 'vibration': 0, 'acoustic': 61.4, 'source': 'simulation'}, 'sandbox/test')
    point = service.get_window('sandbox-001')[0]
    assert point['source'] == 'simulation'
    assert point['vibration'] == 0
    assert point['acoustic'] == 61.4
    assert point['timestamp'] == 123


def test_unlabelled_telemetry_is_not_claimed_as_real():
    point = MQTTPipelineService()._normalize('test', {'timestamp':123,'vibration':1})
    assert point['source'] == 'unknown'
