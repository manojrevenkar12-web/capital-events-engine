import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AuditService } from "./audit/audit.service.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { ProblemFilter } from "./common/errors.js";
import { DbModule } from "./db/db.module.js";
import { EventsService } from "./events/events.service.js";
import { NoticesService } from "./events/notices.service.js";
import { FundsService } from "./funds/funds.service.js";
import {
  AuditController,
  DevController,
  EventsController,
  FundsController,
  HealthController,
  PaymentsController,
  PortalController,
  SideLettersController,
} from "./http/controllers.js";
import { LedgerService } from "./ledger/ledger.service.js";
import { OutboxService } from "./outbox/outbox.service.js";
import { PaymentsService } from "./payments/payments.service.js";
import { SideLettersService } from "./side-letters/side-letters.service.js";

@Module({
  imports: [DbModule],
  controllers: [
    HealthController,
    DevController,
    FundsController,
    SideLettersController,
    EventsController,
    PaymentsController,
    AuditController,
    PortalController,
  ],
  providers: [
    AuditService,
    LedgerService,
    OutboxService,
    FundsService,
    SideLettersService,
    EventsService,
    NoticesService,
    PaymentsService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
export class AppModule {}
