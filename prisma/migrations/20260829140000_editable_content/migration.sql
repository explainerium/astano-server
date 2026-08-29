-- The shop edits its own pages, instead of a developer editing the catalogue.
--
-- The storefront's marketing copy ships in frontend/messages/{de,en}.json and
-- its pictures in frontend/src/lib/pageMedia.ts. Those files stay and remain the
-- defaults; these three tables are an override layer merged over them per
-- request. Empty tables therefore mean the site reads exactly as it does today,
-- which is what makes this safe to deploy before a single string is edited.
--
-- Purely additive, deliberately: three new tables, three indexes, three foreign
-- keys, and nothing dropped, deleted or overwritten. There is no local database
-- on this project — DATABASE_URL is the live Supabase instance — so a migration
-- written here runs against production data on the first `migrate deploy`.

-- CreateTable
--
-- Keyed on the message catalogue's own dotted path rather than an id of our
-- own, so the merge on the storefront is a lookup and not a mapping table.
-- Per locale, because 192 of the 198 editable strings genuinely differ between
-- German and English — the English pages are their own translations, not
-- renderings of the German, and one edit must never reach both.
CREATE TABLE "content_entries" (
    "key" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_entries_pkey" PRIMARY KEY ("key", "locale")
);

-- CreateTable
--
-- No locale column, and that is the point: the marketing pictures are shared by
-- both languages today, and "change this picture" means one thing to the shop.
CREATE TABLE "content_media" (
    "key" TEXT NOT NULL,
    "assetId" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_media_pkey" PRIMARY KEY ("key")
);

-- CreateTable
--
-- Impressum, Datenschutz and AGB to begin with, and whatever the shop writes
-- afterwards. Separate from content_entries because the German privacy policy
-- alone runs to about ten thousand words of HTML, which has no business in the
-- message bundle every page loads.
CREATE TABLE "pages" (
    "slug" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("slug", "locale")
);

-- CreateIndex
--
-- The storefront asks for one language at a time and takes every override in
-- it. The primary key leads on "key", so it cannot answer that on its own.
CREATE INDEX "content_entries_locale_idx" ON "content_entries"("locale");

-- AddForeignKey
--
-- SET NULL on all three, which is this schema's convention for an authorship or
-- asset link: deleting the member of staff must not take the wording with them,
-- and deleting a picture from the library must leave a page that falls back to
-- its shipped default rather than one that cannot be loaded.
ALTER TABLE "content_entries" ADD CONSTRAINT "content_entries_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_media" ADD CONSTRAINT "content_media_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_media" ADD CONSTRAINT "content_media_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
