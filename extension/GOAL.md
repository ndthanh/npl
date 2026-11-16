# Goal development loop

Type `/goal` in Nopilot chat and press Enter. Define the objective, one Definition of Done item per line, a workspace-relative scope, a verification command, and the minimum expected test count. You can also type `/goal <objective>` to prefill the form.

The first version targets Python tools verified with `unittest`, for example:

```cmd
python -m unittest discover -s csvcheck/acceptance -v
```

The command runs with the configured Nopilot Python interpreter, from the workspace root, with a 120-second limit. It does not create a venv or install dependencies. Goal v1 suits stdlib tools; other dependencies must be prepared and approved separately. Shell chaining, PowerShell, and alternative test runners are not accepted by this verifier.

## Workflow

1. Create acceptance tests independently when possible. List their exact workspace-relative file paths under protected tests. Nopilot records their hashes and rejects changes to them in Goal proposals.
2. Start the Goal. Nopilot selects Develop, includes fresh source within the specified scope, applies `.nopilotignore`, and pauses the ordinary message queue. The scope replaces the normal project file selection while the Goal is active.
3. Copilot proposes a changeset or project download. Accept all or selected files in the existing changes card. Nopilot backs up source with Git before applying changes. Viewing the diff remains optional in fast review mode.
4. After application, Nopilot stages the fixed verification command. Approve its separate run card. Source approval does not grant execution permission.
5. On failure, inspect the output card and choose **Gửi kết quả để sửa**. If you explicitly enabled automatic feedback in the setup form, the harness sends the last 24 KB of test output and fresh scoped source to the same Copilot conversation automatically. It still waits for approval of the next source change and test command.
6. On success, review the DoD checklist and confirm each item, then choose **Xác nhận hoàn tất**. A model statement such as “done” never completes the Goal.

Passing requires exit code 0, a complete untruncated unittest result, at least the configured number of tests, no skipped/expected-failure tests, unchanged protected test files, and the same source fingerprint at verification and completion. Unsaved workspace editor changes block verification/completion until saved. Zero tests does not pass. This verifies the configured suite; it does not prove arbitrary code is safe or all requirements were tested. Developer confirmation covers the remaining DoD items.

## Pause, resume and budget

Use the Goal card or `/goal pause`, `/goal resume`, `/goal verify`, `/goal feedback`, `/goal finish`. Rejecting a Goal proposal pauses the loop. If a stored Copilot JSON proposal was not parsed, **Đọc lại đề xuất** reprocesses that saved reply without submitting another turn; current context/hash and scope checks still apply. Reloading VS Code pauses an unfinished Goal and expires execution approval; no command or prompt is replayed automatically. If a request is uncertain, first use the existing exact-turn recovery controls.

Each Goal has 20 Copilot submissions. At the limit, choose **Thêm 20 lượt** explicitly. The counter is cumulative; a grant increases the limit and does not erase history. A new Goal requires completing the existing one or starting a new Nopilot conversation.

The small local GGUF model is not required for this loop. The orchestration, scope checks and completion decision are deterministic; Copilot writes and repairs the code. Goal v1 disables web/browser tool proposals during the loop so they cannot consume hidden extra iterations.

## Validated example: CSV checker

Tested through the installed extension in actual VS Code and actual Teams Copilot. The fixture uses `goal-csv-checker/` as scope, eight independently written acceptance tests, a protected oracle hash and the command:

```cmd
python -m unittest discover -s goal-csv-checker/acceptance -v
```

The harness QA prompt deliberately requested a first milestone without duplicate-ID detection. The first run produced eight tests with exactly one failure. Automatic feedback reached the same Teams conversation, Copilot returned a focused repair, and the second approved run passed all eight tests. The acceptance oracle stayed byte-identical. Goal completion remained blocked until the test agent confirmed the DoD through the UI; an actual README edit after the green run also blocked completion. The original verified bytes were restored before completion.

This validates the scoped stdlib workflow, not every dependency installer, project type or future Copilot output format.
