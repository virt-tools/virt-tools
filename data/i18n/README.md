# Localization (i18n)

The site is hand-written static HTML: copy lives in the markup *and* inside each
page's inline calculator script, and neither has stable keys. This pipeline
therefore translates by exact English source string, keeps the English page as
the single source of truth, and publishes a localized page only when its whole
translation is present and still matches the English page.

Nothing is machine-translated at build time. There is no translation service in
the loop and no runtime translation: the CSP hash-pins every inline script, so
translations are baked per locale before the SEO/CSP pass runs.

## Layout

    data/i18n/locales.json              locale registry (code, name, dir, path)
    data/i18n/messages/<code>.json      shell strings, category and group names
    data/i18n/tools/<code>/<slug>.json  one translation memory per tool page
    frontend/assets/i18n/<code>.js      generated runtime bundle (committed)
    frontend/assets/i18n/manifest.json  generated page inventory (build output)

`frontend/assets/app.js` carries the English defaults (`VT_EN`) and the locale
directory (`LOCALES`) so a page renders without an extra request.
`scripts/generate_i18n.py --check` fails when either duplicates drift from
`data/i18n/`.

## What a locale covers today

  * the shared shell — header, navigation, search, filters, sort, saved tools,
    counts, empty states, tool-page actions, privacy center — everywhere,
    including English tool pages;
  * the homepage catalog, with translated names and descriptions where a tool
    memory exists and English otherwise;
  * a tool page, only when `data/i18n/tools/<code>/<slug>.json` is complete and
    its `sourceHash` matches the current English page.

Everything else stays English, deliberately. The catalog grows by roughly twenty
pages a day; silently publishing half-translated pages would be worse than an
honest English fallback.

## Adding a tool translation

    # 1. Extract the page's translatable units (block paragraphs keep their
    #    inline <b>/<code> markup; script literals are keyed by their text).
    python3 scripts/i18n_lib.py extract frontend/tools/<slug>/index.html

    # 2. Write data/i18n/tools/<code>/<slug>.json with:
    #      slug, locale, name, description, reviewed, sourceHash, strings{}

    # 3. Regenerate bundles and the localized pages.
    python3 scripts/generate_i18n.py frontend --bundles-only
    python3 scripts/generate_i18n.py --check

`name` and `description` are what the homepage catalog row shows; `strings` must
cover every extracted unit, and identity mappings are allowed for sample data
that must not be translated (placeholders such as `col1,col2 val1,val2`).

## Keeping translations honest

`python3 scripts/i18n_status.py` prints, per locale, how many pages are current,
stale or untranslated. `--check` (run by `scripts/preflight.sh`) fails when a
translated page changed without its memory being updated, so a cycle that edits
a localized page must update the translation in the same commit or delete the
memory to fall back to English on purpose.

The maintenance cycle may translate one newly added tool per run; a new tool
otherwise ships in English and sits in the untranslated bucket.

## Adding a locale

1. Append an entry to `data/i18n/locales.json`.
2. Copy `data/i18n/messages/en.json` to `<code>.json` and translate it.
3. Mirror the entry in `frontend/assets/app.js` (`LOCALES`).
4. Add `/frontend/<path>/` to `.gitignore`.
5. Run `python3 scripts/generate_i18n.py frontend --bundles-only`.
6. Commit the new `frontend/assets/i18n/<code>.js`.

For a right-to-left language, set `"dir": "rtl"`: the build writes `dir="rtl"` on
the `<html>` element, and `frontend/assets/style.css` uses logical properties
where it matters, but page-level inline CSS in individual tool pages has not been
audited for RTL.

## Known limitations

  * Numeric inputs accept a dot decimal separator only (about 600 pages carry a
    dot-only regex). A German or Spanish user typing `1,5` is rejected. The
    example placeholders therefore keep a dot. Fixing this is a shared-parser
    refactor, not a translation task.
  * Tool pages whose result rows are built by string concatenation are covered,
    but a literal that mixes markup with an interpolated value only translates
    its static text.
  * `vt:guidance` and `vt:method` metadata stay English: they are review notes
    from the catalog, not page copy.
  * Layouts were tuned for English at 320 px. A translation that grows past a
    fixed-width row needs its own layout pass; the browser probe only covers the
    pages that exist in the current locale set.
