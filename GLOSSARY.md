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
