-- DropForeignKey
ALTER TABLE `invoices` DROP FOREIGN KEY `invoices_clientId_fkey`;

-- DropForeignKey
ALTER TABLE `payment_links` DROP FOREIGN KEY `payment_links_clientId_fkey`;

-- AlterTable
ALTER TABLE `invoices` MODIFY `clientId` INTEGER NULL;

-- AlterTable: new payment_links columns. organizationId starts nullable so
-- the backfill below can run before NOT NULL is enforced — every existing
-- row currently has a real clientId, so the backfill is deterministic and
-- lossless.
ALTER TABLE `payment_links` ADD COLUMN `customerEmail` VARCHAR(191) NULL,
    ADD COLUMN `customerName` VARCHAR(150) NULL,
    ADD COLUMN `customerPhone` VARCHAR(20) NULL,
    ADD COLUMN `organizationId` INTEGER NULL,
    MODIFY `clientId` INTEGER NULL;

-- Backfill organizationId from each row's existing client.
UPDATE `payment_links` pl
JOIN `clients` c ON c.id = pl.clientId
SET pl.organizationId = c.organizationId;

-- Every row now has a value — enforce NOT NULL.
ALTER TABLE `payment_links` MODIFY `organizationId` INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX `payment_links_organizationId_idx` ON `payment_links`(`organizationId`);

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_links` ADD CONSTRAINT `payment_links_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_links` ADD CONSTRAINT `payment_links_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
