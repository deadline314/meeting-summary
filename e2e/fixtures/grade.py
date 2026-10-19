"""Sample grader: imports the student's `add` from solution.py and runs hidden cases."""
import json, os, sys, importlib.util

sub, data, out = sys.argv[1], sys.argv[2], sys.argv[3]
files = [f for f in os.listdir(sub) if f.endswith(".py")]
spec = importlib.util.spec_from_file_location("solution", os.path.join(sub, files[0]))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

cases = [((1, 2), 3), ((-1, 1), 0), ((10, 5), 15), ((2.5, 2.5), 5.0)]
details, ok = [], 0
for i, (args, want) in enumerate(cases, 1):
    try:
        got = mod.add(*args)
        passed = got == want
        details.append({"name": f"case_{i}", "passed": passed, "message": "" if passed else f"add{args} = {got}，應為 {want}"})
        ok += passed
    except Exception as e:  # noqa: BLE001
        details.append({"name": f"case_{i}", "passed": False, "message": f"{type(e).__name__}: {e}"})

score = ok / len(cases)
result = {"passed": score == 1, "score": score, "details": details}
if score < 1:
    result["message"] = f"通過 {ok}/{len(cases)} 個測試，請檢查錯誤的案例"
else:
    result["message"] = "全部通過"
json.dump(result, open(os.path.join(out, "result.json"), "w"), ensure_ascii=False)
