# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the e-mail and password of the X-Sense account are fields of the
  Gladys configuration (the password a `secret` field). The integration reads
  them from Gladys, keeps them in memory and never writes them to `/data` nor to
  the logs. The password never leaves the container: the sign-in uses the SRP
  protocol of AWS Cognito.
- **Stored in `/data`** (`xsense.json`, readable by the container user only):
  the Cognito session tokens of the account (access, id and refresh tokens), the
  last self-test result of each detector, and the detectors whose low battery was
  already announced. The temporary AWS credentials of the shadows and MQTT stay
  in memory.
- **Network**: outgoing HTTPS only, to the X-Sense API
  (`api.x-sense-iot.com`), AWS Cognito (`cognito-idp.<region>.amazonaws.com`),
  the AWS IoT shadows (`<region>.x-sense-iot.com`) and the AWS IoT MQTT broker
  over a secure WebSocket. Certificates are verified. The integration opens no
  port and sends no command to the detectors.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the third-party services and devices the integration talks to.
