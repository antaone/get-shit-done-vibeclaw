# Step: post_merge_gate

Post-merge build & test gate. Runs after all worktrees in a wave are merged
(parallel mode), or after the last plan completes (serial mode). Catches
cross-plan integration failures that individual worktree self-checks cannot
detect.

**Step A — Build gate:**

```bash
# Resolve build and test commands once: workflow.build_command / workflow.test_command win,
# otherwise checks.detect applies the Xcode > Makefile > language rules.
CHECKS_JSON=$(fvgsd-sdk query checks.detect 2>/dev/null || echo '{}')
BUILD_CMD=$(printf '%s' "$CHECKS_JSON" | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d;}).on("end",()=>{try{process.stdout.write(JSON.parse(s).build||"");}catch{}})')
if [ -z "$BUILD_CMD" ]; then
  echo "⚠ No build command detected — skipping build gate"
fi
# Run build with 5-minute timeout
BUILD_EXIT=0
if [ -n "$BUILD_CMD" ]; then
  timeout 300 bash -c "$BUILD_CMD" 2>&1
  BUILD_EXIT=$?
  if [ "${BUILD_EXIT}" -eq 0 ]; then
    echo "✓ Post-merge build gate passed"
  elif [ "${BUILD_EXIT}" -eq 124 ]; then
    echo "⚠ Post-merge build gate timed out after 5 minutes"
  else
    echo "✗ Post-merge build gate failed (exit code ${BUILD_EXIT})"
    WAVE_FAILURE_COUNT=$((WAVE_FAILURE_COUNT + 1))
  fi
fi
```

**If `BUILD_EXIT` is 0 (pass):** `✓ Build gate passed` → proceed to Test gate.

**If `BUILD_EXIT` is 124 (timeout):** Log warning, treat as non-blocking, continue to Test gate.

**If `BUILD_EXIT` is non-zero (build failure):** Increment `WAVE_FAILURE_COUNT` (same semantics as test failures). Present failure output and offer "Fix now" or "Continue" options (same as step 5.8).

**Step B — Test gate:**

```bash
# Test command from the same checks.detect result as Step A.
[ -n "${CHECKS_JSON:-}" ] || CHECKS_JSON=$(fvgsd-sdk query checks.detect 2>/dev/null || echo '{}')
TEST_CMD=$(printf '%s' "$CHECKS_JSON" | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d;}).on("end",()=>{try{process.stdout.write(JSON.parse(s).test||"");}catch{}})')
if [ -z "$TEST_CMD" ]; then
  TEST_CMD="true"
  echo "⚠ No test runner detected — skipping post-merge test gate"
fi
# Run test suite with 5-minute timeout
TEST_EXIT=0
timeout 300 bash -c "$TEST_CMD" 2>&1
TEST_EXIT=$?
if [ "${TEST_EXIT}" -eq 0 ]; then
  echo "✓ Post-merge test gate passed — no cross-plan conflicts"
elif [ "${TEST_EXIT}" -eq 124 ]; then
  echo "⚠ Post-merge test gate timed out after 5 minutes"
else
  echo "✗ Post-merge test gate failed (exit code ${TEST_EXIT})"
  WAVE_FAILURE_COUNT=$((WAVE_FAILURE_COUNT + 1))
fi
```

**If `TEST_EXIT` is 0 (pass):** `✓ Post-merge test gate: {N} tests passed — no cross-plan conflicts` → continue to orchestrator tracking update.

**If `TEST_EXIT` is 124 (timeout):** Log warning, treat as non-blocking, continue. Tests may need a longer budget or manual run.

**If `TEST_EXIT` is non-zero (test failure):** Increment `WAVE_FAILURE_COUNT` to track
cumulative failures across waves. Subsequent waves should report:
`⚠ Note: ${WAVE_FAILURE_COUNT} prior wave(s) had test failures`
