"""Resolve as referencias cruzadas dos manifestos k8s renderizados e reporta as quebradas."""
import subprocess, sys, yaml

BASE = sys.argv[1]
out = subprocess.run(["kubectl", "kustomize", BASE], capture_output=True, text=True)
if out.returncode:
    print("kustomize falhou:", out.stderr[:300]); sys.exit(1)

docs = [d for d in yaml.safe_load_all(out.stdout) if d]
by_kind = {}
for d in docs:
    by_kind.setdefault(d["kind"], []).append(d)

def nomes(kind):
    return {d["metadata"]["name"] for d in by_kind.get(kind, [])}

falhas = []


def erro(cat, msg):
    falhas.append((cat, msg))

secrets = {d["metadata"]["name"]: set((d.get("stringData") or {}) | (d.get("data") or {}))
           for d in by_kind.get("Secret", [])}
cfgmaps = nomes("ConfigMap")
services = {d["metadata"]["name"]: d for d in by_kind.get("Service", [])}

# rotulos de pod disponiveis, por workload
pod_labels = []
for kind in ("Deployment", "StatefulSet", "DaemonSet"):
    for d in by_kind.get(kind, []):
        pod_labels.append((kind, d["metadata"]["name"],
                           d["spec"]["template"]["metadata"].get("labels", {})))

# 1. secretKeyRef / configMapRef resolvem?
for kind in ("Deployment", "StatefulSet"):
    for d in by_kind.get(kind, []):
        spec = d["spec"]["template"]["spec"]
        for ctype in ("initContainers", "containers"):
            for c in spec.get(ctype, []):
                origem = f"{kind}/{d['metadata']['name']} {ctype[:-1]}={c['name']}"
                for e in c.get("env", []):
                    ref = (e.get("valueFrom") or {}).get("secretKeyRef")
                    if ref:
                        chaves = secrets.get(ref["name"])
                        if chaves is None:
                            erro("ref", f"{origem}: Secret '{ref['name']}' nao existe")
                        elif ref["key"] not in chaves:
                            erro("ref", f"{origem}: env {e['name']} -> chave '{ref['key']}' "
                                        f"ausente no Secret '{ref['name']}' (tem: {sorted(chaves)})")
                for ef in c.get("envFrom", []):
                    cm = (ef.get("configMapRef") or {}).get("name")
                    if cm and cm not in cfgmaps:
                        erro("ref", f"{origem}: ConfigMap '{cm}' nao existe")

# 2. Ingress -> Service
for ing in by_kind.get("Ingress", []):
    for rule in ing["spec"].get("rules", []):
        for p in rule.get("http", {}).get("paths", []):
            svc = p["backend"]["service"]["name"]
            if svc not in services:
                erro("ref", f"Ingress/{ing['metadata']['name']}: backend '{svc}' nao existe "
                            f"(services: {sorted(services)})")

# 3. Service selector casa com algum pod?
for nome, svc in services.items():
    sel = svc["spec"].get("selector")
    if not sel:
        continue
    if not any(all(lbl.get(k) == v for k, v in sel.items()) for _, _, lbl in pod_labels):
        erro("ref", f"Service/{nome}: selector {sel} nao casa com nenhum pod template")

# 4. HPA / PDB
for hpa in by_kind.get("HorizontalPodAutoscaler", []):
    alvo = hpa["spec"]["scaleTargetRef"]["name"]
    if alvo not in nomes("Deployment"):
        erro("ref", f"HPA/{hpa['metadata']['name']}: scaleTargetRef '{alvo}' nao existe")
    mn, mx = hpa["spec"].get("minReplicas", 1), hpa["spec"]["maxReplicas"]
    if mx < mn:
        erro("logica", f"HPA/{hpa['metadata']['name']}: maxReplicas {mx} < minReplicas {mn}")

for pdb in by_kind.get("PodDisruptionBudget", []):
    if "spec" not in pdb:
        erro("schema", f"PDB/{pdb['metadata']['name']}: sem spec no nivel raiz "
                       f"(chaves em metadata: {sorted(pdb['metadata'])})")

# 5. ServiceAccount: automount no lugar certo?
for sa in by_kind.get("ServiceAccount", []):
    if "automountServiceAccountToken" in sa["metadata"]:
        erro("schema", f"ServiceAccount/{sa['metadata']['name']}: automountServiceAccountToken "
                       f"dentro de metadata (campo e de nivel raiz) - sera ignorado")

# 6. serviceAccountName referencia SA existente?
for kind in ("Deployment", "StatefulSet"):
    for d in by_kind.get(kind, []):
        san = d["spec"]["template"]["spec"].get("serviceAccountName")
        if san and san not in nomes("ServiceAccount"):
            erro("ref", f"{kind}/{d['metadata']['name']}: serviceAccountName '{san}' nao existe")
        if not san:
            erro("seg", f"{kind}/{d['metadata']['name']}: sem serviceAccountName (usa a default)")

# 7. probes e resources
for kind in ("Deployment", "StatefulSet"):
    for d in by_kind.get(kind, []):
        for c in d["spec"]["template"]["spec"].get("containers", []):
            origem = f"{kind}/{d['metadata']['name']} container={c['name']}"
            if not c.get("resources", {}).get("limits"):
                erro("seg", f"{origem}: sem resources.limits")
            for p in ("livenessProbe", "readinessProbe"):
                if p not in c:
                    erro("seg", f"{origem}: sem {p}")

# 8. PSA restricted
psa = {ns["metadata"]["name"]: ns["metadata"].get("labels", {}).get(
    "pod-security.kubernetes.io/enforce") for ns in by_kind.get("Namespace", [])}
for kind in ("Deployment", "StatefulSet"):
    for d in by_kind.get(kind, []):
        if psa.get(d["metadata"].get("namespace")) != "restricted":
            continue
        pspec = d["spec"]["template"]["spec"]
        psec = pspec.get("securityContext", {})
        for ctype in ("initContainers", "containers"):
            for c in pspec.get(ctype, []):
                origem = f"{kind}/{d['metadata']['name']} {ctype[:-1]}={c['name']}"
                sec = c.get("securityContext", {})
                if sec.get("allowPrivilegeEscalation") is not False:
                    erro("psa", f"{origem}: allowPrivilegeEscalation != false")
                if sorted(sec.get("capabilities", {}).get("drop", [])) != ["ALL"]:
                    erro("psa", f"{origem}: capabilities.drop != [ALL]")
                if not (psec.get("runAsNonRoot") or sec.get("runAsNonRoot")):
                    erro("psa", f"{origem}: runAsNonRoot ausente")
                if not (psec.get("seccompProfile") or sec.get("seccompProfile")):
                    erro("psa", f"{origem}: seccompProfile ausente")

# 9. credencial em texto plano fora de Secret
for kind in ("Deployment", "StatefulSet"):
    for d in by_kind.get(kind, []):
        for c in d["spec"]["template"]["spec"].get("containers", []):
            for e in c.get("env", []):
                if "value" in e and any(t in e["name"].upper()
                                        for t in ("PASSWORD", "SECRET", "TOKEN", "KEY")):
                    erro("seg", f"{kind}/{d['metadata']['name']} container={c['name']}: "
                                f"{e['name']} com valor literal, fora de Secret")

print(f"manifestos renderizados: {len(docs)}\n")
if not falhas:
    print("nenhuma referencia quebrada")
else:
    largura = max(len(c) for c, _ in falhas)
    for cat, m in falhas:
        print(f"[{cat:>{largura}}] {m}")
    print(f"\ntotal: {len(falhas)}")
