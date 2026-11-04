# Link existing users explicitly

Each relying-party application keeps its existing users, data, and sessions when adopting the central identity provider. An existing application user may be linked to a central identity only after proof of control of both; matching email addresses never merge users automatically, and conflicting links require reviewed recovery. This adds friction to migration but prevents a central sign-in from taking over an unrelated application user's data. Relying parties must disable implicit same-email OAuth linking.
