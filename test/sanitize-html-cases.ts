import fixtureRecords from "./fixtures/tidings-issue-40.json";

export type SanitizeCase = {
  id: string;
  html: string;
  baseUrl?: string;
};

// Inputs are the committed Tidings fixture bodies, the existing sanitizer examples,
// and article markup that uses the tags and attributes sanitizeHtmlContent allows.
// Base URLs match the adapter calls in src/adapters/tidings.ts and
// src/adapters/the-christadelphian.ts.
export const sanitizeCases: SanitizeCase[] = [
  ...fixtureRecords.map((record) => ({
    id: `tidings-fixture:${record.type}:${record.slug}`,
    html: record.content,
    baseUrl: "https://tidings.org/",
  })),
  {
    id: "html-test:executable-attributes",
    html:
      "<p>Setting one = 1 and online = true.</p>" +
      '<a href=javascript:alert(1) onclick="alert(2)">unsafe</a>' +
      '<a title="5 > 3" onclick="alert(4)">quoted angle</a>' +
      '<a href="javascript&colon;alert(5)">encoded scheme</a>' +
      '<svg/onload="alert(3)"></svg>',
  },
  {
    id: "html-test:structural-attributes",
    html: '<h2 id="section">Section</h2><table><tr><td colspan="2">Text</td></tr></table>',
  },
  {
    id: "html-test:absolute-urls",
    baseUrl: "https://tidings.org/articles/example/",
    html:
      '<a href="/about">About</a><a href=" #section">Jump</a>' +
      '<a href="javascript:alert(1)">Unsafe</a>' +
      '<img src="images/photo.jpg" srcset="/small.jpg 1x, images/large.jpg 2x">' +
      '<img src="data:text/html,unsafe">',
  },
  {
    id: "tidings:article-body",
    baseUrl: "https://tidings.org/",
    html:
      '<p><img src="https://tidings.org/image.webp" /></p>' +
      "<p><i>James Andrews,<br>Kenilworth Ecclesia</i></p>" +
      "<p><i>Steve Petrou,<br>Toronto West Ecclesia</i></p>" +
      '<p onclick="alert(1)">Complete <strong>article</strong>.</p>' +
      '<script>alert("unsafe")</script><a href="javascript:alert(1)">bad</a>' +
      '<p class="p9"><span class="s3"><i>David Fraser</i></span>' +
      "<i>,<br />Pinetown Ecclesia, South Africa</i></p>",
  },
  {
    id: "the-christadelphian:article-body",
    baseUrl: "https://thechristadelphian.com/",
    html:
      '<p class="Author">Harry Whittaker</p>' +
      '<figure class="wp-block-image">' +
      '<img src="/wp-content/uploads/photo.jpg" ' +
      'srcset="/wp-content/uploads/photo-300.jpg 300w, images/photo.jpg 1024w" ' +
      'alt="Congregation" width="1024" height="576" loading="lazy">' +
      "<figcaption>A gathering</figcaption></figure>" +
      '<h2 id="known">Known by name</h2>' +
      '<p>Text with <a href="/blog/the-christadelphian/known-by-name/" title="Article">a link</a>, ' +
      '<a href="mailto:office@thechristadelphian.com">email</a>, and ' +
      '<a href="tel:+441234567890">phone</a>.</p>' +
      '<p>Fragment <a href="#known">jump</a> and external ' +
      '<a href="https://tidings.org/magazine/" target="_blank">Tidings</a>.</p>' +
      '<blockquote cite="https://thechristadelphian.com/quote"><p>Quoted words.</p></blockquote>' +
      '<table><thead><tr><th scope="col" colspan="2">Heading</th></tr></thead>' +
      '<tbody><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></tbody></table>' +
      '<ol start="2" type="a"><li>First continued point</li><li>Second</li></ol>' +
      "<ul><li>Bullet</li></ul>" +
      '<div style="line-height: 14px; font-size: 12px;">' +
      '<p class="p1">Styled note that should keep the paragraph.</p></div>',
  },
];
