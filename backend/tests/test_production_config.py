"""Production rejects unsafe bootstrap values without exposing them in errors."""
import pytest
from pydantic import ValidationError
from app.config import Settings


def test_development_secret_is_process_local_and_demo_defaults_are_preserved(monkeypatch):
    monkeypatch.delenv('SECRET_KEY', raising=False)
    first, second = Settings(_env_file=None), Settings(_env_file=None)
    assert first.secret_key != second.secret_key
    assert first.seed_demo_devices is True
    assert 'secret_key=' not in repr(first)


def test_production_requires_explicit_nontrivial_secret(monkeypatch):
    monkeypatch.delenv('SECRET_KEY', raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, runtime_environment='production')
    marker = 'config-leak-marker'
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, runtime_environment='production', secret_key=marker)
    assert marker not in str(error.value)
    for weak in ['x'*50, 'industrial-diagnosis-old-demo-configuration']:
        with pytest.raises(ValidationError):
            Settings(_env_file=None, runtime_environment='production', secret_key=weak)


def test_production_has_no_implicit_demo_seed_or_weak_admin():
    key = 'test-only-' + 'a9B3c7D1e8F2g6H4i0J5kL8mN3pQ6rS2'
    settings = Settings(_env_file=None, runtime_environment='production', secret_key=key)
    assert settings.seed_demo_devices is False
    assert not settings.bootstrap_admin_password
    with pytest.raises(ValidationError):
        Settings(_env_file=None, runtime_environment='production', secret_key=key,
                 bootstrap_admin_password='short')
    configured = Settings(_env_file=None, runtime_environment='production', secret_key=key,
                          bootstrap_admin_password='only-a-test-fixture-2026', seed_demo_devices=True)
    assert configured.seed_demo_devices is True


def test_production_seed_does_not_insert_implicit_admin_or_demo_devices(monkeypatch):
    from types import SimpleNamespace
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app import main
    from app.models import Base, User
    from app.modules.auth.security import verify_password

    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    monkeypatch.setattr(main, 'SessionLocal', sessions)
    configuration = SimpleNamespace(runtime_environment='production',
                                    seed_demo_devices=False,
                                    bootstrap_admin_username='initial-owner',
                                    bootstrap_admin_password='')
    monkeypatch.setattr(main, 'settings', configuration)
    main._seed_admin()
    with sessions() as db:
        assert db.query(User).count() == 0

    # Disabling demo devices must not even open the database.
    with monkeypatch.context() as guard:
        guard.setattr(main, 'SessionLocal', lambda: pytest.fail('unexpected demo database access'))
        main._seed_devices()

    configuration.bootstrap_admin_password = 'only-a-test-fixture-2026'
    main._seed_admin()
    with sessions() as db:
        initial = db.query(User).one()
        assert initial.username == 'initial-owner' and initial.role == 'admin'
        assert verify_password(configuration.bootstrap_admin_password, initial.password_hash)
        original_hash = initial.password_hash
    configuration.bootstrap_admin_password = 'a-different-test-fixture-2026'
    main._seed_admin()
    with sessions() as db:
        assert db.query(User).one().password_hash == original_hash
    engine.dispose()
