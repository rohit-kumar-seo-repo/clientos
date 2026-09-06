-- CreateTable
CREATE TABLE `client_service_categories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clientServiceId` INTEGER NOT NULL,
    `category` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `client_service_categories_clientServiceId_idx`(`clientServiceId`),
    INDEX `client_service_categories_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `client_service_categories` ADD CONSTRAINT `client_service_categories_clientServiceId_fkey` FOREIGN KEY (`clientServiceId`) REFERENCES `client_services`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
