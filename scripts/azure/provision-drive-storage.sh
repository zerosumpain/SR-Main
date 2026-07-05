#!/usr/bin/env bash
# Reproducible provisioning for the /drive Azure Blob backend.
# Idempotent: safe to re-run. Requires `az login` (or the sr-homeserv-automation
# service principal) with rights on the subscription.
#
# NOTE: the service principal (below, commented) is created ONCE — re-running it
# mints a new secret. Everything else is create-if-not-exists.
set -euo pipefail

SUB="${AZURE_SUBSCRIPTION_ID:-4bbb12aa-42e5-43d7-9c74-14def0bcf54d}"
RG="${AZURE_RG:-sr-drive-rg}"
LOC="${AZURE_LOCATION:-uksouth}"
ACCT="${AZURE_STORAGE_ACCOUNT:-srdrive4bbb12aa}"
CONTAINER="${AZURE_BLOB_CONTAINER:-drive}"

echo "==> resource group $RG @ $LOC"
az group create --name "$RG" --location "$LOC" --subscription "$SUB" --output none

echo "==> storage provider registered"
az provider register --namespace Microsoft.Storage --subscription "$SUB" --wait

echo "==> storage account $ACCT (Standard_LRS, Hot, GPv2, private, TLS1.2)"
az storage account create \
  --name "$ACCT" --resource-group "$RG" --subscription "$SUB" --location "$LOC" \
  --sku Standard_LRS --kind StorageV2 --access-tier Hot \
  --min-tls-version TLS1_2 --https-only true --allow-blob-public-access false \
  --output none

CONN="$(az storage account show-connection-string \
  --name "$ACCT" --resource-group "$RG" --subscription "$SUB" \
  --query connectionString -o tsv)"

echo "==> private container $CONTAINER"
az storage container create --name "$CONTAINER" --connection-string "$CONN" --public-access off --output none

# One-time automation credential (Contributor scoped to this RG). Uncomment to
# recreate; store appId/password/tenant securely (VPS .env / secret store):
# az ad sp create-for-rbac --name sr-homeserv-automation \
#   --role Contributor --scopes "/subscriptions/$SUB/resourceGroups/$RG" --output json

echo "==> done. Set on the app host:"
echo "    AZURE_STORAGE_CONNECTION_STRING=<from: az storage account show-connection-string ...>"
echo "    AZURE_BLOB_CONTAINER=$CONTAINER"
