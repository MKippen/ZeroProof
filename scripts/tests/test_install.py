"""Installer regression checks in a disposable tree with no Docker/network access."""

import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest


INSTALL_SCRIPT = Path(__file__).resolve().parents[1] / "install.sh"


class InstallerTest(unittest.TestCase):
    def setUp(self):
        self.fixture = tempfile.TemporaryDirectory(prefix="zeroproof-install-test-")
        self.addCleanup(self.fixture.cleanup)
        self.root = Path(self.fixture.name)
        (self.root / "scripts").mkdir()
        shutil.copyfile(INSTALL_SCRIPT, self.root / "scripts/install.sh")
        shutil.copyfile(INSTALL_SCRIPT.parent / "configure-mqtt.sh", self.root / "scripts/configure-mqtt.sh")
        (self.root / "nginx/ssl").mkdir(parents=True)
        (self.root / "nginx/ssl/server.crt").touch()
        (self.root / "nginx/ssl/server.key").touch()
        (self.root / "mosquitto/config").mkdir(parents=True)
        self.commands = self.root / "commands.log"
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.mock("docker", '''
printf 'docker %s\\n' "$*" >> "$COMMAND_LOG"
if [ "$1" = compose ] && [ "$2" = build ]; then
    exit "${BUILD_EXIT:-0}"
fi
if [ "$1" = run ]; then
    exit "${MQTT_CONFIG_EXIT:-0}"
fi
''')
        self.mock("curl", '''
printf 'curl %s\\n' "$*" >> "$COMMAND_LOG"
case "$*" in
    *-f*api/v1/auth/setup-status*) exit "${API_EXIT:-0}" ;;
    *) exit 0 ;;
esac
''')
        self.mock("sleep", "exit 0\n")
        self.mock("lsof", "exit 1\n")

    def mock(self, name, body):
        path = self.bin / name
        path.write_text("#!/bin/bash\n" + body)
        path.chmod(0o755)

    def run_install(self, answers="", **settings):
        env = {
            **os.environ,
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "COMMAND_LOG": str(self.commands),
            "SKIP_FIRMWARE_DOWNLOAD": "true",
            "INSTALL_HEALTH_TIMEOUT_SECONDS": "1",
            **settings,
        }
        # Run from outside the checkout to verify script-relative paths.
        return subprocess.run(
            ["bash", str(self.root / "scripts/install.sh")],
            cwd=self.root.parent,
            env=env,
            input=answers,
            text=True,
            capture_output=True,
            timeout=15,
        )

    def test_success_requires_api_readiness_and_creates_private_credentials(self):
        result = self.run_install()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Installation Complete!", result.stdout)
        self.assertEqual(stat.S_IMODE((self.root / ".env").stat().st_mode), 0o600)
        self.assertIn("https://127.0.0.1/api/v1/auth/setup-status", self.commands.read_text())
        self.assertNotIn("https://localhost/health", self.commands.read_text())

    def test_regenerated_credentials_fix_existing_world_readable_permissions(self):
        credentials = self.root / ".env"
        credentials.write_text("EXISTING=fixture\n")
        credentials.chmod(0o644)
        result = self.run_install(answers="y\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(stat.S_IMODE(credentials.stat().st_mode), 0o600)

    def test_build_failure_is_not_reported_as_success(self):
        result = self.run_install(BUILD_EXIT="42")
        self.assertEqual(result.returncode, 42)
        self.assertNotIn("Installation Complete!", result.stdout)
        self.assertNotIn("docker compose up", self.commands.read_text())

    def test_mqtt_configuration_failure_stops_install(self):
        result = self.run_install(MQTT_CONFIG_EXIT="13")
        self.assertEqual(result.returncode, 13)
        self.assertNotIn("Installation Complete!", result.stdout)
        self.assertNotIn("docker compose build", self.commands.read_text())

    def test_http_error_is_not_reported_as_success(self):
        result = self.run_install(API_EXIT="22")
        self.assertEqual(result.returncode, 1)
        self.assertIn("Application did not become ready", result.stdout)
        self.assertNotIn("Installation Complete!", result.stdout)


if __name__ == "__main__":
    unittest.main()
