-- AlterTable
ALTER TABLE `billing_plans` MODIFY `frequency` ENUM('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'ONE_TIME') NOT NULL DEFAULT 'MONTHLY';

-- AlterTable
ALTER TABLE `client_activity` ADD COLUMN `actorAdminId` INTEGER NULL;

-- AlterTable
ALTER TABLE `client_services` ADD COLUMN `endDate` DATETIME(3) NULL,
    ADD COLUMN `nextActionDate` DATETIME(3) NULL,
    ADD COLUMN `nextActionNote` VARCHAR(255) NULL,
    ADD COLUMN `progressPercent` INTEGER NULL,
    ADD COLUMN `workNote` VARCHAR(500) NULL,
    ADD COLUMN `workStatus` ENUM('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD') NOT NULL DEFAULT 'NOT_STARTED';

-- AlterTable
ALTER TABLE `payments` ADD COLUMN `recordedByAdminId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `client_activity` ADD CONSTRAINT `client_activity_actorAdminId_fkey` FOREIGN KEY (`actorAdminId`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_recordedByAdminId_fkey` FOREIGN KEY (`recordedByAdminId`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
