-- `ProductKind` is an admin-only dashboard label, so PRODUCT reads better as
-- MAIN ("main product" vs "option product"). Renaming the enum value keeps
-- every existing row and the column default intact — dropping and recreating
-- the type, which Prisma would otherwise generate, would not.
ALTER TYPE "ProductKind" RENAME VALUE 'PRODUCT' TO 'MAIN';
