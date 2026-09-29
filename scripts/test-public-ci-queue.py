import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("queue_driver", Path(__file__).with_name("public-ci-queue.py"))
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


class PublicQueueProofTests(unittest.TestCase):
    def run_record(self, **changes):
        return dict(id=10, head_sha="a" * 40, workflow_id=1, head_branch="ci/test",
                    event="workflow_dispatch", status="completed", conclusion="success") | changes

    def test_unrelated_or_automatic_runs_cannot_prove_a_commit(self):
        for changes in [{"head_sha": "b" * 40}, {"workflow_id": 2},
                        {"head_branch": "other"}, {"event": "push"}]:
            self.assertIsNone(driver.latest_result([self.run_record(**changes)], "a" * 40, 1, "ci/test"))

    def test_newer_cancelled_run_supersedes_old_green(self):
        result = driver.latest_result([self.run_record(), self.run_record(id=11, conclusion="cancelled")],
                                      "a" * 40, 1, "ci/test")
        self.assertEqual(result["conclusion"], "cancelled")

    def test_pending_run_is_not_success(self):
        self.assertIsNone(driver.latest_result([self.run_record(status="in_progress")], "a" * 40, 1, "ci/test"))

    def test_private_sandbox_is_rejected_before_enqueue(self):
        with patch.object(driver, "api", return_value={"private": True}), patch.object(driver, "command") as command:
            with self.assertRaisesRegex(RuntimeError, "must be public"):
                driver.queue(1)
            command.assert_not_called()

    def test_missing_or_foreign_head_proof_is_rejected(self):
        for statuses in [[], [{"context": driver.CONTEXT, "state": "success", "target_url": "https://github.com/private/repo/actions"}]]:
            with patch.object(driver, "api", side_effect=[{"private": False}, {"state": "open", "head": {"sha": "a" * 40}}, {"statuses": statuses}]), patch.object(driver, "command") as command:
                with self.assertRaisesRegex(RuntimeError, "needs successful"):
                    driver.queue(1)
                command.assert_not_called()


if __name__ == "__main__":
    unittest.main()
