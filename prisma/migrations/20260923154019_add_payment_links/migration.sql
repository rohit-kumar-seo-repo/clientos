-- AlterTable
ALTER TABLE `payments` ADD COLUMN `currency` VARCHAR(3) NOT NULL DEFAULT 'INR',
    ADD COLUMN `paymentLinkId` INTEGER NULL;

-- CreateTable
CREATE TABLE `payment_links` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clientId` INTEGER NOT NULL,
    `billingPeriodId` INTEGER NULL,
    `projectMilestoneId` INTEGER NULL,
    `projectAddOnId` INTEGER NULL,
    `razorpayPaymentLinkId` VARCHAR(60) NOT NULL,
    `razorpayShortUrl` VARCHAR(255) NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `amountInPaise` INTEGER NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'INR',
    `allowsPartialPayment` BOOLEAN NOT NULL DEFAULT false,
    `minPartialAmountInPaise` INTEGER NULL,
    `expiresAt` DATETIME(3) NULL,
    `status` ENUM('CREATED', 'PARTIALLY_PAID', 'PAID', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'CREATED',
    `createdByAdminId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_links_razorpayPaymentLinkId_key`(`razorpayPaymentLinkId`),
    INDEX `payment_links_clientId_idx`(`clientId`),
    INDEX `payment_links_billingPeriodId_idx`(`billingPeriodId`),
    INDEX `payment_links_projectMilestoneId_idx`(`projectMilestoneId`),
    INDEX `payment_links_projectAddOnId_idx`(`projectAddOnId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `payments_paymentLinkId_idx` ON `payments`(`paymentLinkId`);

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_paymentLinkId_fkey` FOREIGN KEY (`paymentLinkId`) REFERENCES `payment_links`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_links` ADD CONSTRAINT `payment_links_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_links` ADD CONSTRAINT `payment_links_billingPeriodId_fkey` FOREIGN KEY (`billingPeriodId`) REFERENCES `billing_periods`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_links` ADD CONSTRAINT `payment_links_projectMilestoneId_fkey` FOREIGN KEY (`projectMilestoneId`) REFERENCES `project_milestones`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_links` ADD CONSTRAINT `payment_links_projectAddOnId_fkey` FOREIGN KEY (`projectAddOnId`) REFERENCES `project_add_ons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_links` ADD CONSTRAINT `payment_links_createdByAdminId_fkey` FOREIGN KEY (`createdByAdminId`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
