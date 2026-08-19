"""Valida a forma dos workflows do GitHub Actions e reporta o que o parser YAML aceita em silencio."""
import pathlib, re, sys, yaml

DIR = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".github/workflows")
RUNNERS = re.compile(r"ubuntu-latest|ubuntu-\d\d\.\d\d|windows-latest|macos-latest")

falhas = []
def erro(cat, msg):
    falhas.append((cat, msg))

arquivos = sorted(p for p in DIR.iterdir() if p.suffix in (".yml", ".yaml"))
if not arquivos:
    print(f"nenhum workflow em {DIR}"); sys.exit(1)

total_jobs = 0
for p in arquivos:
    try:
        doc = yaml.safe_load(p.read_text())
    except yaml.YAMLError as e:
        erro("yaml", f"{p.name}: nao parseia — {str(e)[:120]}"); continue

    # arquivo vazio parseia como None: YAML valido, workflow invalido
    if doc is None:
        erro("vazio", f"{p.name}: arquivo vazio — o Actions recusa o workflow"); continue

    # `on` sem aspas vira o booleano True na chave (YAML 1.1). Aceitar as duas formas.
    if True not in doc and "on" not in doc:
        erro("gatilho", f"{p.name}: sem 'on' no nivel raiz")

    # o achado central: indentacao errada aninha `jobs` dentro de `on` e o
    # arquivo continua sendo YAML valido, so que sem nenhum job.
    if "jobs" not in doc:
        erro("estrutura", f"{p.name}: sem 'jobs' no nivel raiz — chaves de topo: "
                          f"{[k if k is not True else 'on' for k in doc]}")
        continue

    for jn, job in doc["jobs"].items():
        total_jobs += 1
        if not isinstance(job, dict):
            erro("estrutura", f"{p.name}:{jn}: job nao e um mapeamento"); continue

        if "uses" in job:      # reusable workflow: nao tem runs-on nem steps
            continue

        alvo = str(job.get("runs-on", ""))
        if not RUNNERS.fullmatch(alvo):
            erro("runner", f"{p.name}:{jn}: runs-on '{alvo}' nao e um runner hospedado — "
                           f"o job fica na fila indefinidamente")

        for dep in job.get("needs") or []:
            if dep not in doc["jobs"]:
                erro("needs", f"{p.name}:{jn}: needs '{dep}', que nao existe neste arquivo")

        passos = job.get("steps")
        if not passos:
            erro("estrutura", f"{p.name}:{jn}: sem 'steps'"); continue

        for i, s in enumerate(passos):
            origem = f"{p.name}:{jn}: step {i} ({s.get('name') or s.get('uses') or '?'})"
            if not isinstance(s, dict):
                erro("estrutura", f"{origem}: nao e um mapeamento"); continue
            # `- name:` e `- uses:` como itens de lista distintos caem aqui
            if ("uses" in s) == ("run" in s):
                erro("passo", f"{origem}: precisa de exatamente um entre 'uses' e 'run'")
            u = s.get("uses", "")
            if u and "@" not in u:
                erro("versao", f"{origem}: uses '{u}' sem referencia fixada")
            if u.endswith(("@master", "@main")):
                erro("versao", f"{origem}: uses '{u}' fixado em branch movel — "
                               f"o passo muda sem que o repositorio mude")

print(f"workflows: {len(arquivos)}  jobs: {total_jobs}\n")
if not falhas:
    print("nenhum defeito estrutural")
else:
    largura = max(len(c) for c, _ in falhas)
    for cat, m in falhas:
        print(f"[{cat:>{largura}}] {m}")
    print(f"\ntotal: {len(falhas)}")
    sys.exit(1)
