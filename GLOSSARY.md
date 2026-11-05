# Identity and Application Access

The central identity provider authenticates people for independently operated applications. Each application retains ownership of its own users and access rules.

## Language

**Central Identity**:
A person's identity at the central authentication provider. It is distinct from an application's user record for that person.
_Avoid_: Shared application user

**Application User**:
An application's record for a person, with its own identifier, data, and access rules. A person can have a central identity without being a user of every application.
_Avoid_: Application account, shared user

**Identity Link**:
The association between one central identity and one application user, established only after proof of control of both when linking an existing user. A matching email address alone is not proof.
_Avoid_: Email match

**Central SSO Session**:
The identity provider's browser session, used to authenticate a person during later authorization requests from other applications.
_Avoid_: Application session

**Application Session**:
An application's own session established after it validates a central identity; it does not end merely because the central SSO session ends.
_Avoid_: SSO session

**Relying Party**:
An independently operated application that accepts Central Identity authentication while retaining its own Application Users, Application Sessions, and access rules.
_Avoid_: Demo application, shared application

**External Provider**:
An independently operated identity service, such as Google or GitHub, used to authenticate a Central Identity. It is not a Relying Party.
_Avoid_: Relying Party, Central Identity

**Provider Link**:
The association between an External Provider account and a Central Identity. A second provider requires explicit linking, not a matching email address.
_Avoid_: Identity Link, Email match

**Reviewed Recovery**:
Restoration of control of an existing Central Identity after independent proof of ownership. A matching email address alone is insufficient.
_Avoid_: Automatic email linking

**Authentication Portal**:
The Central Identity user interface for signing in through External Providers, linking providers, and ending the Central SSO Session.
_Avoid_: Application dashboard, launcher
