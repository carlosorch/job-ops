#import "@preview/rendercv:0.3.0": *

#let source = json(__RESUME_DATA_PATH__)

#let resume-name = if source.at("name", default: "") == none { "" } else { source.at("name", default: "") }
#set document(
  title: if resume-name == "" { "Resume" } else { resume-name + " CV" },
  author: resume-name,
)

#let with-default(value, fallback) = {
  if value == none { fallback } else { value }
}

#let text-of(value) = with-default(value, "")
#let markup-text(value) = eval(text-of(value), mode: "markup")
#let list-of(value) = with-default(value, ())
#let text-of-item(item, key) = text-of(item.at(key, default: ""))
#let section-titles = with-default(source.at("sectionTitles", default: (:)), (:))

#let contact-items = list-of(source.at("contactItems", default: ()))
#let profile-items = list-of(source.at("profileItems", default: ()))

#let link-or-text(label, url, icon: false) = {
  if url == "" { label } else { link(url, icon: icon, if-underline: false, if-color: false)[#label] }
}

#let connection-label(label, url, connection-icon) = {
  let content = [#connection-with-icon(connection-icon)[#label]]
  if url == "" { content } else { link(url, icon: false, if-underline: false, if-color: false)[#content] }
}

#let contact-matching(predicate) = {
  let matches = contact-items.filter(predicate)
  if matches.len() > 0 { matches.at(0) } else { none }
}

#let profile-matching(predicate) = {
  let matches = profile-items.filter(predicate)
  if matches.len() > 0 { matches.at(0) } else { none }
}

#let contact-label-matching(predicate, connection-icon) = {
  let item = contact-matching(predicate)
  if item == none {
    none
  } else {
    connection-label(text-of-item(item, "text"), text-of-item(item, "url"), connection-icon)
  }
}

#let profile-label-matching(predicate, connection-icon) = {
  let item = profile-matching(predicate)
  if item == none {
    none
  } else {
    let label = text-of-item(item, "username")
    let network = text-of-item(item, "network")
    let url = text-of-item(item, "url")
    let rendered = if label != "" { label } else if network != "" { network } else { url }
    connection-label(rendered, url, connection-icon)
  }
}

#let is-email(item) = {
  let text = text-of-item(item, "text")
  let url = text-of-item(item, "url")
  text.contains("@") or url.starts-with("mailto:")
}

#let is-website-contact(item) = {
  let url = text-of-item(item, "url")
  url != "" and not is-email(item)
}

#let is-phone(item) = {
  text-of-item(item, "url") == "" and not is-email(item)
}

#let is-linkedin-profile(item) = {
  let network = text-of-item(item, "network")
  let url = text-of-item(item, "url")
  network.contains("LinkedIn") or network.contains("linkedin") or url.contains("linkedin")
}

#let is-github-profile(item) = {
  let network = text-of-item(item, "network")
  let url = text-of-item(item, "url")
  network.contains("GitHub") or network.contains("Github") or network.contains("github") or url.contains("github")
}

#let is-website-profile(item) = {
  let url = text-of-item(item, "url")
  url != "" and not is-linkedin-profile(item) and not is-github-profile(item)
}

#let present(items) = items.filter(item => item != none and item != [])

#let bullets-of(entry) = {
  list-of(entry.at("bullets", default: ()))
    .filter(item => text-of(item) != "")
    .map(item => markup-text(item))
}

#let bullet-block(entry) = {
  let bullets = bullets-of(entry)
  if bullets.len() == 0 {
    []
  } else [
    #for item in bullets [
      - #item
    ]
  ]
}

#let linked-entry-label(entry, label) = {
  link-or-text(label, text-of-item(entry, "url"), icon: false)
}

#let entry-heading(entry, title, subtitle: "") = {
  let location = text-of-item(entry, "secondarySubtitle")
  let subline = if subtitle != "" and location != "" {
    subtitle + " -- " + location
  } else if subtitle != "" {
    subtitle
  } else {
    location
  }
  (
    first: [#strong[#linked-entry-label(entry, title)]#if subline != "" [#text[, #emph[#subline]]]],
    second: [#text-of-item(entry, "date")],
  )
}

#let regular-section(title, entries, title-key: "title", subtitle-key: "subtitle") = {
  if entries.len() == 0 {
    []
  } else [
    == #title
    #for entry in entries [
      #let heading = entry-heading(entry, text-of-item(entry, title-key), subtitle: text-of-item(entry, subtitle-key))
      #regular-entry(heading.first, heading.second, main-column-second-row: bullet-block(entry))
    ]
  ]
}

#show: rendercv.with(
  name: resume-name,
  title: if resume-name == "" { "Resume" } else { resume-name + " CV" },
  locale-catalog-language: "en",
  page-size: "a4",
  page-top-margin: 0.55in,
  page-bottom-margin: 0.55in,
  page-left-margin: 0.62in,
  page-right-margin: 0.62in,
  page-show-footer: false,
  page-show-top-note: false,
  typography-line-spacing: 0.54em,
  typography-alignment: "left",
  typography-font-family-body: "Libertinus Serif",
  typography-font-family-name: "Libertinus Serif",
  typography-font-family-headline: "Libertinus Serif",
  typography-font-family-connections: "Libertinus Serif",
  typography-font-family-section-titles: "Libertinus Serif",
  typography-font-size-body: 9.4pt,
  typography-font-size-name: 22pt,
  typography-font-size-headline: 9.2pt,
  typography-font-size-connections: 8.8pt,
  typography-font-size-section-titles: 1.05em,
  typography-bold-name: true,
  typography-bold-section-titles: true,
  links-underline: false,
  links-show-external-link-icon: false,
  header-alignment: center,
  header-space-below-name: 0.15cm,
  header-space-below-headline: 0.15cm,
  header-space-below-connections: 0.35cm,
  header-connections-hyperlink: true,
  header-connections-show-icons: true,
  header-connections-display-urls-instead-of-usernames: false,
  header-connections-separator: "|",
  header-connections-space-between-connections: 0.28cm,
  section-titles-type: "with_full_line",
  section-titles-line-thickness: 0.45pt,
  section-titles-space-above: 0.28cm,
  section-titles-space-below: 0.14cm,
  sections-allow-page-break: false,
  sections-space-between-text-based-entries: 0.08cm,
  sections-space-between-regular-entries: 0.22cm,
  entries-date-and-location-width: 3.4cm,
  entries-space-between-columns: 0.1cm,
  entries-allow-page-break: false,
  entries-summary-space-above: 0.02cm,
  entries-highlights-space-above: 0.03cm,
  entries-highlights-space-between-items: 0.02cm,
  entries-highlights-space-between-bullet-and-text: 0.25em,
)

= #resume-name

#let headline = text-of(source.at("headline", default: ""))
#if headline != "" [
  #v(2mm)
  #align(center)[#headline]
]

#align(center)[
  #connections(..present((
    if text-of(source.at("location", default: "")) != "" { connection-label(text-of(source.at("location", default: "")), "", "location-dot") },
    contact-label-matching(is-email, "envelope"),
    contact-label-matching(is-phone, "phone"),
    profile-label-matching(is-linkedin-profile, "linkedin"),
    profile-label-matching(is-github-profile, "github"),
    if profile-matching(is-website-profile) != none { profile-label-matching(is-website-profile, "link") } else { contact-label-matching(is-website-contact, "link") },
  )))
]

#let summary = text-of(source.at("summary", default: ""))
#if summary != "" [
  == #text-of(section-titles.at("summary", default: "Summary"))
  #markup-text(summary)
]

#let custom-fields = list-of(source.at("customFieldItems", default: ()))
#if custom-fields.len() > 0 [
  == #text-of(section-titles.at("customFields", default: "Custom Fields"))
  #for item in custom-fields [
    #let title = text-of-item(item, "title")
    #let label = if title != "" { [#strong[#title:] #text-of-item(item, "text")] } else { text-of-item(item, "text") }
    #link-or-text(label, text-of-item(item, "url"), icon: false) \
  ]
]

#regular-section(
  text-of(section-titles.at("experience", default: "Experience")),
  list-of(source.at("experience", default: ())),
)

#regular-section(
  text-of(section-titles.at("projects", default: "Projects")),
  list-of(source.at("projects", default: ())),
)

#regular-section(
  text-of(section-titles.at("education", default: "Education")),
  list-of(source.at("education", default: ())),
)

#let skill-groups = list-of(source.at("skillGroups", default: ()))
#if skill-groups.len() > 0 [
  == #text-of(section-titles.at("skills", default: "Skills"))
  #for group in skill-groups [
    #strong[#text-of-item(group, "name"):] #list-of(group.at("keywords", default: ())).join(", ") \
  ]
]

#let languages = list-of(source.at("languages", default: ()))
#if languages.len() > 0 [
  == #text-of(section-titles.at("languages", default: "Languages"))
  #for item in languages [
    #strong[#text-of-item(item, "language"):] #text-of-item(item, "fluency") \
  ]
]

#let interests = list-of(source.at("interests", default: ()))
#if interests.len() > 0 [
  == #text-of(section-titles.at("interests", default: "Interests"))
  #for item in interests [
    #strong[#text-of-item(item, "name"):] #list-of(item.at("keywords", default: ())).join(", ") \
  ]
]

#regular-section(
  text-of(section-titles.at("awards", default: "Awards")),
  list-of(source.at("awards", default: ())),
)

#regular-section(
  text-of(section-titles.at("certifications", default: "Certifications")),
  list-of(source.at("certifications", default: ())),
)

#regular-section(
  text-of(section-titles.at("publications", default: "Publications")),
  list-of(source.at("publications", default: ())),
)

#regular-section(
  text-of(section-titles.at("volunteer", default: "Volunteer")),
  list-of(source.at("volunteer", default: ())),
)

#regular-section(
  text-of(section-titles.at("references", default: "References")),
  list-of(source.at("references", default: ())),
)
