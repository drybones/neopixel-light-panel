import React from 'react';

/*
 * One block of the settings page: a heading, an optional line saying what the
 * block is for, and a body of rows.
 *
 * Sections are deliberately dumb containers rather than a config-driven list.
 * Each one owns its own state and its own server calls (power settings poll,
 * import/export talk to the scene store), so there is nothing to centralise —
 * adding a section means writing a component and dropping it into
 * SettingsPage, and nothing else changes.
 */
export default function SettingsSection({ title, description, children }) {
  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <h2 className="settings-section-title">{title}</h2>
        {description && <p className="settings-section-description">{description}</p>}
      </div>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

/*
 * A labelled row. `control` is whatever sits on the right — an input, a
 * button pair, or just a read-only value. Rows are a flat list rather than a
 * grid so a long hint can wrap under its label without dragging the control
 * out of alignment with the rows above it.
 *
 * `interactive` makes the row a <label>, which associates it with the control
 * nested inside by containment — no ids to keep unique. A read-only row stays
 * a <div>: labelling a value that cannot be edited just gives a screen reader
 * a control that isn't there.
 */
export function SettingsRow({ label, hint, control, interactive }) {
  const Tag = interactive ? 'label' : 'div';
  return (
    <Tag className="settings-row">
      <span className="settings-row-text">
        <span className="settings-row-label">{label}</span>
        {hint && <span className="settings-row-hint">{hint}</span>}
      </span>
      <span className="settings-row-control">{control}</span>
    </Tag>
  );
}
