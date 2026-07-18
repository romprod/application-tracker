# Initial administrator setup

A fresh Application Tracker database is closed. It contains no user and no
default password. The health endpoint and setup status remain available, but
setup cannot complete until the operator configures a one-time token.

## Configure the token

Generate at least 32 random bytes. For example:

```sh
openssl rand -hex 32
```

Place the result in the deployment environment as `SETUP_TOKEN`, then start or
restart Application Tracker. Do not commit the populated `.env` file or send
the token to another person.

`GET /api/setup/status` returns two booleans:

- `required` is true until the first administrator transaction succeeds.
- `tokenConfigured` reports whether this process received a usable token.

## Create the administrator

Open Application Tracker in a browser after restarting with the token. The
first-run screen collects these fields:

| Field           | Requirement                                             |
| --------------- | ------------------------------------------------------- |
| `setupToken`    | The complete one-time token, 32 to 512 characters       |
| `username`      | 3 to 64 letters, numbers, dots, underscores, or hyphens |
| `displayName`   | 1 to 120 characters                                     |
| `password`      | 12 to 128 characters                                    |
| `workspaceName` | 1 to 120 characters                                     |

The operation hashes the password with a uniquely salted scrypt hash and
creates the workspace, local credential, administrator membership, and setup
completion marker in one database transaction.

The browser keeps the password and token only in the live form state. It does
not place them in a URL, browser storage, or application log, and it removes
the form from memory after setup succeeds.

After a successful response, remove `SETUP_TOKEN` from the environment and
restart the service. The database completion marker permanently closes setup,
so retaining or later restoring the same token cannot create another
administrator.

Local login is available immediately after setup. Completing setup clears the
form from memory and sends the operator to the login screen.

After signing in, the first administrator can create additional local admin or
member accounts under **Settings → Users**.
