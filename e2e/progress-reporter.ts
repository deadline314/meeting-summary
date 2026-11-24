import type { FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter'

// One live progress bar instead of a line per test; failures are printed as they happen.
export default class Progress implements Reporter {
  total = 0
  done = 0
  failed = 0
  skipped = 0
  start = Date.now()

  onBegin(_config: unknown, suite: Suite) {
    this.total = suite.allTests().length
  }

  onTestEnd(test: TestCase, r: TestResult) {
    this.done++
    if (r.status === 'skipped') this.skipped++
    else if (r.status !== test.expectedStatus) {
      this.failed++
      process.stdout.write(`\n\x1b[31mFAIL\x1b[0m ${test.titlePath().slice(1).join(' > ')}\n     ${r.error?.message?.split('\n')[0] ?? ''}\n`)
    }
    const w = 40
    const f = Math.round((w * this.done) / this.total)
    const s = (Date.now() - this.start) / 1000
    const eta = Math.round((s * (this.total - this.done)) / this.done)
    const pct = Math.round((100 * this.done) / this.total)
    // In a terminal the bar redraws in place; piped to a file, one line per test.
    process.stdout.write(
      `${process.stdout.isTTY ? '\r' : '\n'}[${'#'.repeat(f)}${'-'.repeat(w - f)}] ${pct}% ${this.done}/${this.total}  pass ${this.done - this.failed - this.skipped}  fail ${this.failed}  skip ${this.skipped}  ${Math.round(s)}s, ~${eta}s left   `,
    )
  }

  // What tests print themselves (timings and the like).
  onStdOut(chunk: string | Buffer) {
    process.stdout.write(`\n${String(chunk).trimEnd()}`)
  }

  onEnd(r: FullResult) {
    process.stdout.write(`\n${r.status.toUpperCase()} in ${Math.round((Date.now() - this.start) / 1000)}s\n`)
  }
}
