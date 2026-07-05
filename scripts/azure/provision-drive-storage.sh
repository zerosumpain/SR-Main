#!/usr/bin/env bash
# DEPRECATED — Azure provisioning is now Infrastructure-as-Code (Terraform).
#
# The resource group, storage account, and containers are managed in:
#   ~/homeserv-infra/azure/   (repo: zerosumpain/homeserv-infra)
#
# To change infra (e.g. onboard a new service's container):
#   cd ~/homeserv-infra/azure && source ./activate.sh && terraform apply
#
# This script is kept only for historical reference of the original imperative
# provisioning. Do not run it — Terraform owns this infra now.
echo "DEPRECATED: Azure infra is managed by Terraform in ~/homeserv-infra/azure/." >&2
echo "Run 'terraform plan/apply' there instead. See that module's README.md." >&2
exit 1
