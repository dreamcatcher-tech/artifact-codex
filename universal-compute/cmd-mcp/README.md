What to do (server-only)

- Make jobs resumable/idempotent:
  - start_task(args) -> {taskId}
  - await_task(taskId, max_wait_ms?) -> final result or “still_running”
  - get_task_status(taskId) -> status/result
  - cancel_task(taskId) -> optional cleanup
- Ensure await_task returns immediately with the result if the task already
  finished, so a later turn can “resume” by calling it again using the recorded
  taskId (it’s preserved in conversation history via the tool result).
