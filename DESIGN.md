# Central Identity Frontend Design System

## 1. Visual theme and atmosphere

Use the Stitch **Responsive Authentication Portal** as the visual reference: calm, secure, and direct. Keep its white/slate canvas, dark navy identity panel, blue actions, geometric security motif, and content-first sign-in composition.

The project’s Stitch theme metadata is empty. This specification normalizes tokens from its desktop and mobile screen HTML, resolving their inconsistent font and color values. **Square geometry is intentional:** the repository’s existing requirement for unrounded borders overrides rounded corners and pills in the Stitch mockups.

Use this system across `/`, `/sign-in`, `/sign-up`, `/forgot-password`, and `/reset-password`, plus the signed-in session state. Recovery and session screens have no Stitch mockups; extend the same typography, surfaces, forms, and status treatments without adding new decorative styles.

## 2. Color palette and roles

### Primary foundation
- **Canvas (`#f8fafc`)**: Page background; cool, pale slate.
- **Surface (`#ffffff`)**: Forms, recovery panels, and session content.
- **Navy (`#0f2c4d`)**: Security/welcome panel and high-emphasis dark surface.
- **Deep Navy (`#091624`)**: Navy panel depth and contrast; avoid broad gradient decoration.
- **Border (`#e2e8f0`)**: Structural dividers and panel outlines.

### Accent and interactive
- **Identity Blue (`#1652a2`)**: Primary actions, links, and focused controls.
- **Blue Hover (`#124182`)**: Hover/pressed action state.
- **Sky Accent (`#38bdf8`)**: Small decorative security accents on navy; never the only state cue.
- **Teal (`#0d9488`)**: Positive status and verification cues.
- **Input Border (`#cbd5e1`)**: Default form control outline.

### Typography and text hierarchy
- **Ink (`#1e293b`)**: Primary headings and body text.
- **Muted (`#64748b`)**: Secondary copy and supporting labels.
- **On Navy (`#ffffff`)**: Hero headings and primary panel text.
- **On Navy Muted (`#cbd5e1`)**: Supporting hero copy.

### Functional states
- **Success (`#0d9488`)**: Verified, completed, or active session; pair color with a text label.
- **Error (`#b91c1c`)**: Inline validation and operation failures; include a concise explanation and recovery action where applicable.
- **Focus (`#1652a2`)**: Visible focus outline/ring with sufficient contrast; never remove keyboard focus indication.
- **Disabled (`#f1f5f9`)**: Muted input surface and clear disabled affordance; retain readable text contrast.

## 3. Typography rules

Use **Inter** at every viewport. The Stitch desktop uses Inter, while its mobile mockup falls back to system fonts; standardize both on Inter for continuity. Use a system sans-serif fallback when Inter cannot load.

- **Display / hero**: `36px / 44px`, weight `700`, tracking `-0.02em`; mobile `28px / 36px`.
- **Page heading (`h1`)**: `32px / 40px`, weight `700`; mobile `24px / 32px`.
- **Section heading (`h2`)**: `24px / 32px`, weight `600` or `700`.
- **Body**: `16px / 24px`, weight `400`.
- **Supporting copy**: `14px / 22px`, weight `400`.
- **Field labels**: `14px / 20px`, weight `600`; sentence case.
- **Small status / footnote**: `12px / 18px`, weight `500` minimum; do not use tiny uppercase text for essential instructions.

Keep paragraphs readable with a maximum measure near `65ch`. Use sentence case and plain, task-focused language.

## 4. Component stylings

All component corners are **square (`border-radius: 0`)**. Do not use pills, rounded cards, or circular status marks. Use straight borders, spacing, and color to show hierarchy.

- **Primary button**: Identity Blue fill, white text, `48–52px` minimum height, `1px` border. Hover/pressed state darkens the blue without moving or scaling the control. Disabled state is visibly muted.
- **Secondary button**: White/transparent fill, blue text, `1px` Border outline, same minimum height as primary.
- **Input**: White fill, `1px` Input Border outline, `48–52px` minimum height, `12–14px` horizontal padding. Keep the visible label above the field; never use placeholder text as its replacement. Focus changes border/ring to Identity Blue. Error state adds a clear red border and associated inline message.
- **Inline errors**: Place next to the relevant form, with a left red rule, pale red surface, and readable explanation. Use `role="alert"`; preserve errors after submission failure.
- **Success toast**: Fixed near the lower viewport edge, square white surface, green structural accent, concise confirmation, and `role="status"` / polite live announcement. Auto-dismiss after about four seconds; persistent success text may remain in the page where the flow needs it.
- **Panels**: White surface with a thin Border outline. Keep the sign-in welcome panel navy and rectangular; avoid rounded enclosing cards and broad shadows.
- **Security status**: Use a square-edged text label and optional small square marker. State must remain understandable without color or animation.
- **Links**: Identity Blue with visible underline or underline-on-hover; keep keyboard focus visible.

## 5. Layout principles

- **Canvas and grid**: Design against a `1280px` desktop canvas. Main content max width `1200px`; center it with fluid side gutters.
- **Desktop sign-in / signup**: Two-column composition. Navy welcome panel takes roughly `5/12` of the available width; form takes `7/12`. Keep the form constrained to a readable width.
- **Mobile**: Below `760px`, stack the compact welcome banner above the form. Use `16px` minimum side gutters and allow page scrolling; do not clip form errors or disable pinch zoom.
- **Spacing**: Use a `4px` base with an `8px` rhythm. Common gaps: `8px` within fields, `16px` between controls, `24px` between form sections, and `32–48px` between major regions.
- **Touch and keyboard**: Buttons and other primary controls are at least `48px` high. Keep logical tab order, visible focus, and no focus-obscuring fixed overlays.
- **Forms**: Preserve labels, helper text, inline errors, pending state, and success confirmation. Do not replace field errors with toast-only feedback.
- **Motion**: Keep transitions limited to user-triggered color/focus feedback. Respect `prefers-reduced-motion`; never depend on animation to communicate security or status.
- **Responsive text**: Allow browser zoom and user text scaling. Avoid fixed-height form panels; content must grow without overlap.

## 6. Stitch generation notes

**Atmosphere keywords:** Central Identity, secure sign-in, cool slate canvas, navy security panel, restrained blue actions, geometric security lines, square-cornered, responsive, accessible forms.

**Canonical colors:** Canvas `#f8fafc`, Surface `#ffffff`, Navy `#0f2c4d`, Identity Blue `#1652a2`, Sky Accent `#38bdf8`, Teal `#0d9488`, Border `#e2e8f0`, Ink `#1e293b`.

**Prompts for future screens:**
1. Design a Central Identity sign-in page with a square-cornered navy welcome panel beside a clean white labeled form; use Inter, slate borders, and a restrained blue primary action.
2. Design the mobile sign-in and signup views as a single-column flow with a compact square-cornered navy banner above large, accessible form controls; preserve browser zoom and vertical scrolling.
3. Extend the same square-cornered visual system to password recovery and signed-in session status; show field errors inline and operation confirmations in brief accessible toasts.

**Source:** Stitch project “Responsive Authentication Portal” (desktop authentication portal, desktop account registration, mobile sign-in, and mobile signup screens). The generated mockups use rounded components; square corners in this spec follow the explicit frontend requirement instead.
