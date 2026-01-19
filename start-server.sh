#!/bin/bash
# Script to start-up the outlook server with the environment variables taken from 1Password.

# Application (client) ID from Azure Portal
export MICROSOFT_CLIENT_ID=$(op read --account skyscanner.1password.eu "op://Employee/Outlook Client/client-id")

# Client secret VALUE (not the secret ID) from Azure Portal > Certificates & secrets
export MICROSOFT_CLIENT_SECRET=$(op read --account skyscanner.1password.eu "op://Employee/Outlook Client/client-secret")

# Directory (tenant) ID from Azure Portal > Overview
# Use 'common' for multi-tenant, 'organizations' for any org account, or your specific tenant ID
export MICROSOFT_TENANT_ID=$(op read --account skyscanner.1password.eu "op://Employee/Outlook Client/tenant-id")

# Setting up the Slack credentials we need to authenticate.
export SLACK_CLIENT_ID=$(op read --account skyscanner.1password.eu "op://Employee/Slack Credentials/client-id")
export SLACK_CLIENT_SECRET=$(op read --account skyscanner.1password.eu "op://Employee/Slack Credentials/client-secret")

npm start | npx pino-pretty
