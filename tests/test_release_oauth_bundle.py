"""Exercise the real spec data-selection prelude without building an executable."""
import json
from pathlib import Path
import pytest


def bundle(tmp_path, config):
    (tmp_path / "client_secrets.json").write_text(json.dumps(config), encoding="utf-8")
    spec = Path(__file__).resolve().parents[1] / "NEIS_Subject_Teacher.spec"
    prelude = spec.read_text(encoding="utf-8").split("hiddenimports =", 1)[0]
    prelude = prelude.replace("from PyInstaller.utils.hooks import collect_submodules", "")
    scope = {"SPECPATH": str(tmp_path)}
    exec(compile(prelude, str(spec), "exec"), scope)
    return scope["datas"]


def test_installed_oauth_can_be_bundled(tmp_path):
    assert (str(tmp_path / "client_secrets.json"), ".") in bundle(tmp_path, {"installed": {"client_id": "fixture"}})


@pytest.mark.parametrize("config", [{"web": {"client_secret": "FIXTURE_ONLY"}}, {"installed": {}, "web": {}}, {"refresh_token": "FIXTURE_ONLY"}])
def test_web_or_unknown_credentials_cannot_be_bundled(tmp_path, config):
    with pytest.raises(ValueError, match="installed-app"):
        bundle(tmp_path, config)
