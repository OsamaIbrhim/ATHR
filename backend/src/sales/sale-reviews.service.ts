import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PosSaleReviewDecision,
  PosSaleReviewStatus,
  PosTerminal,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { assertBranchAccess } from '../auth/branch-access';
import { OfflineAccountingTicketService } from '../shifts/offline-accounting-ticket.service';
import { sameMoney } from '../common/money';
import { SalesService } from './sales.service';
import {
  ListSaleReviewsDto,
  ResolveSaleReviewDto,
  SubmitSaleReviewDto,
} from './dto/sale-review.dto';
import {
  saleReviewFingerprint,
  saleReviewRejectionConfirmed,
  sanitizeSaleReviewCommand,
  ticketKeyId,
  TICKET_REISSUE_REVIEW_CODES,
} from './sale-review-policy';

const reviewInclude = {
  branch: { select: { id: true, code: true, name_ar: true } },
  terminal: {
    select: { id: true, terminal_code: true, name: true },
  },
  origin_cashier: {
    select: { id: true, name: true, role: true, branch_id: true },
  },
  seller: { select: { id: true, name: true, role: true } },
  shift: {
    select: {
      id: true,
      status: true,
      opened_at: true,
      closed_at: true,
    },
  },
  submitter: { select: { id: true, name: true, role: true } },
  reviewer: { select: { id: true, name: true, role: true } },
  linked_invoice: {
    select: { id: true, invoice_number: true, total: true },
  },
} as const;

const PROCESSING_STALE_MS = 2 * 60_000;

@Injectable()
export class SaleReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
    private readonly offlineAccounting: OfflineAccountingTicketService,
  ) {}

  private assertPosContext(
    dto: SubmitSaleReviewDto,
    actor: AuthenticatedUser,
    terminal: Pick<PosTerminal, 'id' | 'branch_id'>,
  ) {
    if (
      dto.command.branch_id !== terminal.branch_id ||
      actor.branch_id !== terminal.branch_id
    ) {
      throw new ForbiddenException(
        'The review request must belong to the authenticated POS branch',
      );
    }
    if (
      dto.command.local_total === undefined ||
      !sameMoney(dto.command.local_total, dto.local_total)
    ) {
      throw new BadRequestException({
        code: 'SALE_REVIEW_LOCAL_TOTAL_MISMATCH',
        message: 'Review total does not match the immutable local command',
        message_ar:
          'إجمالي طلب المراجعة لا يطابق إجمالي العملية المحلية المحفوظة.',
      });
    }
  }

  private assertInvoiceContext(invoice: any, review: {
    branch_id: string;
    terminal_id: string;
    shift_id: string;
    origin_cashier_id: string;
    seller_id: string;
    terminal_sequence: bigint | string;
  }) {
    if (
      invoice.branch_id !== review.branch_id ||
      invoice.terminal_id !== review.terminal_id ||
      invoice.shift_id !== review.shift_id ||
      invoice.cashier_id !== review.origin_cashier_id ||
      invoice.seller_id !== review.seller_id ||
      String(invoice.terminal_sequence || '') !==
        String(review.terminal_sequence)
    ) {
      throw new ConflictException({
        code: 'SALE_REVIEW_EXISTING_INVOICE_CONTEXT_CONFLICT',
        message:
          'The existing invoice does not match the local sale accounting context',
        message_ar:
          'توجد فاتورة بنفس رقم المزامنة لكنها لا تطابق هوية العملية المحلية.',
      });
    }
  }

  private posView(review: any) {
    const resolved =
      review.status === PosSaleReviewStatus.approved ||
      review.status === PosSaleReviewStatus.linked;
    return {
      id: review.id,
      sync_id: review.sync_id,
      status: review.status,
      decision: review.decision,
      action: resolved
        ? 'mark_sent'
        : review.status === PosSaleReviewStatus.rejected
          ? 'reverse_local'
          : 'wait',
      review_reason: review.review_reason,
      resolution_error: review.resolution_error,
      invoice: review.linked_invoice
        ? {
            id: review.linked_invoice.id,
            invoice_number: review.linked_invoice.invoice_number,
            total: review.linked_invoice.total,
          }
        : null,
      updated_at: review.updated_at,
    };
  }

  private async findInvoice(syncId: string) {
    return this.prisma.salesInvoice.findUnique({
      where: { sync_id: syncId },
      select: {
        id: true,
        invoice_number: true,
        total: true,
        branch_id: true,
        terminal_id: true,
        shift_id: true,
        cashier_id: true,
        seller_id: true,
        terminal_sequence: true,
      },
    });
  }

  private async linkExisting(
    review: any,
    invoice: any,
    actor: AuthenticatedUser,
    reason = 'The server already contains the idempotent sale',
  ) {
    this.assertInvoiceContext(invoice, review);
    if (
      [
        PosSaleReviewStatus.approved,
        PosSaleReviewStatus.linked,
      ].includes(review.status) &&
      review.linked_invoice_id === invoice.id
    ) {
      return review;
    }
    if (review.status === PosSaleReviewStatus.rejected) {
      throw new ConflictException(
        'A rejected local sale cannot be linked after reversal',
      );
    }
    const linked = await this.prisma.posSaleReview.update({
      where: { id: review.id },
      data: {
        status: PosSaleReviewStatus.linked,
        decision: PosSaleReviewDecision.link_existing,
        linked_invoice_id: invoice.id,
        reviewed_by: actor.sub,
        reviewed_at: new Date(),
        review_reason: reason,
        resolution_error: null,
      },
      include: reviewInclude,
    });
    await this.prisma.auditLog.create({
      data: {
        user_id: actor.sub,
        action: 'sale.review.linked_existing',
        entity: 'PosSaleReview',
        entity_id: linked.id,
        meta: {
          sync_id: linked.sync_id,
          invoice_id: invoice.id,
          terminal_id: linked.terminal_id,
        },
      },
    });
    return linked;
  }

  private adminView(review: any) {
    const command =
      review.command && typeof review.command === 'object'
        ? review.command as Record<string, any>
        : {};
    const {
      offline_accounting_token_hash: _tokenHash,
      ...safeCommand
    } = command;
    const items = Array.isArray(command.items)
      ? command.items.map((item: Record<string, any>) => {
          const { price_token: _priceToken, ...safeItem } = item;
          return {
            ...safeItem,
            signed_price: !!_priceToken,
          };
        })
      : [];
    return {
      ...review,
      command: {
        ...safeCommand,
        items,
      },
    };
  }

  private async getRaw(id: string, actor: AuthenticatedUser) {
    const review = await this.prisma.posSaleReview.findUnique({
      where: { id },
      include: reviewInclude,
    });
    if (!review) throw new NotFoundException('Sale review not found');
    assertBranchAccess(actor, review.branch_id, ['owner']);
    return review;
  }

  private async recoverStaleProcessing(
    review: any,
    actor: AuthenticatedUser,
  ) {
    if (review.status !== PosSaleReviewStatus.processing) return review;

    const invoice = await this.findInvoice(review.sync_id);
    if (invoice) return this.linkExisting(review, invoice, actor);

    const updatedAt = new Date(review.updated_at).getTime();
    if (
      Number.isFinite(updatedAt) &&
      Date.now() - updatedAt < PROCESSING_STALE_MS
    ) {
      throw new ConflictException(
        'Sale review is already being processed',
      );
    }

    const recovered = await this.prisma.posSaleReview.updateMany({
      where: {
        id: review.id,
        status: PosSaleReviewStatus.processing,
        updated_at: review.updated_at,
      },
      data: {
        status: PosSaleReviewStatus.pending,
        decision: null,
        reviewed_by: null,
        reviewed_at: null,
        review_reason: null,
        resolution_error:
          'Recovered a stale processing claim after an interrupted approval.',
      },
    });
    if (recovered.count !== 1) {
      throw new ConflictException(
        'Sale review state changed while recovering processing',
      );
    }
    await this.prisma.auditLog.create({
      data: {
        user_id: actor.sub,
        action: 'sale.review.processing_recovered',
        entity: 'PosSaleReview',
        entity_id: review.id,
        meta: { sync_id: review.sync_id },
      },
    });
    return this.getRaw(review.id, actor);
  }

  async submit(
    dto: SubmitSaleReviewDto,
    actor: AuthenticatedUser,
    terminal: Pick<PosTerminal, 'id' | 'branch_id'>,
  ) {
    this.assertPosContext(dto, actor, terminal);
    const fingerprint = saleReviewFingerprint(dto.command, terminal.id);
    const safeCommand = sanitizeSaleReviewCommand(dto.command);
    const identity = {
      branch_id: dto.command.branch_id,
      terminal_id: terminal.id,
      origin_cashier_id: dto.command.origin_cashier_id,
      seller_id: dto.command.seller_id,
      shift_id: dto.command.shift_id,
      terminal_sequence: BigInt(dto.command.terminal_sequence),
    };

    let review = await this.prisma.posSaleReview.findUnique({
      where: { sync_id: dto.command.sync_id },
      include: reviewInclude,
    });
    if (review && review.command_fingerprint !== fingerprint) {
      throw new ConflictException({
        code: 'SALE_REVIEW_COMMAND_CONFLICT',
        message: 'sync_id is already attached to another review command',
        message_ar:
          'رقم المزامنة مرتبط بطلب مراجعة مختلف ولا يمكن تغيير بياناته.',
      });
    }

    const invoice = await this.findInvoice(dto.command.sync_id);
    if (invoice) {
      if (!review) {
        review = await this.prisma.posSaleReview.create({
          data: {
            sync_id: dto.command.sync_id,
            ...identity,
            local_invoice_number: dto.local_invoice_number,
            local_total: dto.local_total,
            command: safeCommand as Prisma.InputJsonValue,
            command_fingerprint: fingerprint,
            ticket_key_id: ticketKeyId(
              dto.command.offline_accounting_token,
            ),
            error_code: dto.error_code,
            error_message: dto.error_message,
            source_request_id: dto.request_id,
            attempt_count: dto.attempt_count,
            submitted_by: actor.sub,
          },
          include: reviewInclude,
        });
      }
      return this.posView(
        await this.linkExisting(review, invoice, actor),
      );
    }

    if (!review) {
      try {
        review = await this.prisma.posSaleReview.create({
          data: {
            sync_id: dto.command.sync_id,
            ...identity,
            local_invoice_number: dto.local_invoice_number,
            local_total: dto.local_total,
            command: safeCommand as Prisma.InputJsonValue,
            command_fingerprint: fingerprint,
            ticket_key_id: ticketKeyId(
              dto.command.offline_accounting_token,
            ),
            error_code: dto.error_code,
            error_message: dto.error_message,
            source_request_id: dto.request_id,
            attempt_count: dto.attempt_count,
            submitted_by: actor.sub,
          },
          include: reviewInclude,
        });
        await this.prisma.auditLog.create({
          data: {
            user_id: actor.sub,
            action: 'sale.review.requested',
            entity: 'PosSaleReview',
            entity_id: review.id,
            meta: {
              sync_id: review.sync_id,
              branch_id: review.branch_id,
              terminal_id: review.terminal_id,
              error_code: review.error_code,
              attempt_count: review.attempt_count,
            },
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          review = await this.prisma.posSaleReview.findUnique({
            where: { sync_id: dto.command.sync_id },
            include: reviewInclude,
          });
        } else {
          throw error;
        }
      }
    } else if (dto.attempt_count > review.attempt_count) {
      review = await this.prisma.posSaleReview.update({
        where: { id: review.id },
        data: {
          attempt_count: dto.attempt_count,
          error_code: dto.error_code,
          error_message: dto.error_message,
          source_request_id: dto.request_id,
        },
        include: reviewInclude,
      });
    }
    if (!review) throw new NotFoundException('Sale review was not created');
    if (review.command_fingerprint !== fingerprint) {
      throw new ConflictException({
        code: 'SALE_REVIEW_COMMAND_CONFLICT',
        message: 'sync_id is already attached to another review command',
        message_ar:
          'رقم المزامنة مرتبط بطلب مراجعة مختلف ولا يمكن تغيير بياناته.',
      });
    }
    return this.posView(review);
  }

  async statusForPos(
    syncId: string,
    actor: AuthenticatedUser,
    terminal: Pick<PosTerminal, 'id' | 'branch_id'>,
  ) {
    const review = await this.prisma.posSaleReview.findUnique({
      where: { sync_id: syncId },
      include: reviewInclude,
    });
    if (!review) throw new NotFoundException('Sale review not found');
    if (
      review.branch_id !== terminal.branch_id ||
      review.terminal_id !== terminal.id ||
      actor.branch_id !== terminal.branch_id
    ) {
      throw new ForbiddenException('Sale review belongs to another POS');
    }
    const invoice = await this.findInvoice(syncId);
    if (
      invoice &&
      ![
        PosSaleReviewStatus.approved,
        PosSaleReviewStatus.linked,
      ].includes(review.status)
    ) {
      return this.posView(
        await this.linkExisting(review, invoice, actor),
      );
    }
    return this.posView(review);
  }

  async list(dto: ListSaleReviewsDto, actor: AuthenticatedUser) {
    if (actor.role !== 'owner' && !actor.branch_id) {
      throw new ForbiddenException('Branch manager must belong to a branch');
    }
    const branchId =
      actor.role === 'owner'
        ? dto.branch_id
        : actor.branch_id!;
    const where: Prisma.PosSaleReviewWhereInput = {
      ...(branchId ? { branch_id: branchId } : {}),
      ...(dto.status
        ? { status: dto.status as PosSaleReviewStatus }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.posSaleReview.count({ where }),
      this.prisma.posSaleReview.findMany({
        where,
        include: reviewInclude,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (dto.page - 1) * dto.page_size,
        take: dto.page_size,
      }),
    ]);
    return {
      items: items.map((item) => this.adminView(item)),
      total,
      page: dto.page,
      page_size: dto.page_size,
      total_pages: Math.max(1, Math.ceil(total / dto.page_size)),
    };
  }

  async get(id: string, actor: AuthenticatedUser) {
    return this.adminView(await this.getRaw(id, actor));
  }

  async approve(
    id: string,
    dto: ResolveSaleReviewDto,
    actor: AuthenticatedUser,
  ) {
    let review = await this.getRaw(id, actor);
    if (
      review.status === PosSaleReviewStatus.approved ||
      review.status === PosSaleReviewStatus.linked
    ) {
      return this.adminView(review);
    }
    if (review.status === PosSaleReviewStatus.rejected) {
      throw new ConflictException('Rejected reviews cannot be approved');
    }
    review = await this.recoverStaleProcessing(review, actor);
    if (
      review.status === PosSaleReviewStatus.approved ||
      review.status === PosSaleReviewStatus.linked
    ) {
      return this.adminView(review);
    }
    if (!TICKET_REISSUE_REVIEW_CODES.has(review.error_code)) {
      throw new UnprocessableEntityException({
        code: 'SALE_REVIEW_REISSUE_NOT_ALLOWED',
        message:
          'This error requires a specialized reconciliation workflow',
        message_ar:
          'سبب الرفض الحالي لا يسمح بإعادة إصدار التفويض تلقائيًا ويحتاج مسار تسوية متخصص.',
      });
    }

    const existingInvoice = await this.findInvoice(review.sync_id);
    if (existingInvoice) {
      return this.adminView(await this.linkExisting(
        review,
        existingInvoice,
        actor,
        dto.reason,
      ));
    }

    const claimed = await this.prisma.posSaleReview.updateMany({
      where: {
        id,
        status: PosSaleReviewStatus.pending,
      },
      data: {
        status: PosSaleReviewStatus.processing,
        decision: PosSaleReviewDecision.approve_reissue,
        reviewed_by: actor.sub,
        reviewed_at: new Date(),
        review_reason: dto.reason,
        resolution_error: null,
      },
    });
    if (claimed.count !== 1) {
      const invoice = await this.findInvoice(review.sync_id);
      if (invoice) {
        return this.adminView(
          await this.linkExisting(review, invoice, actor, dto.reason),
        );
      }
      throw new ConflictException(
        'Sale review is already being processed',
      );
    }

    review = await this.getRaw(id, actor);
    try {
      const stored = review.command as unknown as Record<string, any>;
      const {
        offline_accounting_token_hash: _hash,
        ...command
      } = stored;
      const role = review.origin_cashier.role;
      if (!['cashier', 'branch_manager'].includes(role)) {
        throw new UnprocessableEntityException(
          'The original cashier role cannot receive a POS accounting ticket',
        );
      }
      const ticket = this.offlineAccounting.issueReconciliation({
        session_id: String(command.offline_session_id),
        user_id: review.origin_cashier_id,
        role: role as 'cashier' | 'branch_manager',
        branch_id: review.branch_id,
        terminal_id: review.terminal_id,
        shift_id: review.shift_id,
        occurred_at: new Date(String(command.occurred_at)),
      });
      const invoice = await this.sales.createSale(
        {
          ...command,
          offline_accounting_token: ticket.token,
        },
        actor,
        {
          id: review.terminal_id,
          branch_id: review.branch_id,
        },
      );
      const resolved = await this.prisma.posSaleReview.update({
        where: { id },
        data: {
          status: PosSaleReviewStatus.approved,
          linked_invoice_id: invoice.id,
          resolution_error: null,
        },
        include: reviewInclude,
      });
      await this.prisma.auditLog.create({
        data: {
          user_id: actor.sub,
          action: 'sale.review.approved_reissue',
          entity: 'PosSaleReview',
          entity_id: resolved.id,
          meta: {
            sync_id: resolved.sync_id,
            invoice_id: invoice.id,
            original_ticket_key_id: resolved.ticket_key_id,
            terminal_id: resolved.terminal_id,
            origin_cashier_id: resolved.origin_cashier_id,
            shift_id: resolved.shift_id,
          },
        },
      });
      return this.adminView(resolved);
    } catch (error) {
      const invoice = await this.findInvoice(review.sync_id);
      if (invoice) {
        return this.adminView(
          await this.linkExisting(review, invoice, actor, dto.reason),
        );
      }
      await this.prisma.posSaleReview.updateMany({
        where: {
          id,
          status: PosSaleReviewStatus.processing,
        },
        data: {
          status: PosSaleReviewStatus.pending,
          decision: null,
          resolution_error:
            (error instanceof Error ? error.message : String(error))
              .slice(0, 1000),
        },
      });
      throw error;
    }
  }

  async reject(
    id: string,
    dto: ResolveSaleReviewDto,
    actor: AuthenticatedUser,
  ) {
    let review = await this.getRaw(id, actor);
    if (review.status === PosSaleReviewStatus.rejected) {
      return this.adminView(review);
    }
    review = await this.recoverStaleProcessing(review, actor);
    if (
      review.status === PosSaleReviewStatus.approved ||
      review.status === PosSaleReviewStatus.linked
    ) {
      return this.adminView(review);
    }
    if (
      !saleReviewRejectionConfirmed(
        review.local_invoice_number,
        dto.confirmation_reference,
        dto.confirm_financial_settlement,
      )
    ) {
      throw new BadRequestException({
        code: 'SALE_REVIEW_REJECTION_CONFIRMATION_REQUIRED',
        message:
          'Rejecting a paid local sale requires the exact local invoice number and financial settlement confirmation',
        message_ar:
          'رفض عملية محلية يتطلب كتابة رقم الفاتورة المحلي كاملًا وتأكيد عدم تحصيل الدفع أو رد المبلغ للعميل.',
      });
    }
    const invoice = await this.findInvoice(review.sync_id);
    if (invoice) {
      return this.adminView(await this.linkExisting(
        review,
        invoice,
        actor,
        'The invoice already exists and cannot be locally reversed',
      ));
    }

    await this.prisma.$transaction(async (tx) => {
      const existingVoid =
        await tx.posTerminalSequenceVoid.findUnique({
          where: { sync_id: review.sync_id },
        });
      if (existingVoid) {
        if (
          existingVoid.terminal_id !== review.terminal_id ||
          existingVoid.sequence !== review.terminal_sequence
        ) {
          throw new ConflictException({
            code: 'TERMINAL_SEQUENCE_VOID_CONTEXT_CONFLICT',
            message:
              'The sync id already voided another terminal sequence',
            message_ar:
              'رقم المزامنة مستخدم لإلغاء ترتيب مختلف على الجهاز.',
          });
        }
      } else {
        const previousSequence =
          review.terminal_sequence - 1n;
        const claimed = await tx.posTerminal.updateMany({
          where: {
            id: review.terminal_id,
            branch_id: review.branch_id,
            last_sale_sequence: previousSequence,
          },
          data: {
            last_sale_sequence: review.terminal_sequence,
          },
        });
        if (claimed.count !== 1) {
          throw new ConflictException({
            code: 'TERMINAL_SEQUENCE_REJECTION_OUT_OF_ORDER',
            message:
              'The rejected command is not the next terminal sequence',
            message_ar:
              'لا يمكن رفض العملية لأن ترتيبها ليس التالي على الجهاز. راجع العمليات الأقدم أولًا.',
          });
        }
        await tx.posTerminalSequenceVoid.create({
          data: {
            sync_id: review.sync_id,
            branch_id: review.branch_id,
            terminal_id: review.terminal_id,
            sequence: review.terminal_sequence,
            approved_by: actor.sub,
            reason: dto.reason,
          },
        });
      }

      const changed = await tx.posSaleReview.updateMany({
        where: {
          id,
          status: PosSaleReviewStatus.pending,
        },
        data: {
          status: PosSaleReviewStatus.rejected,
          decision: PosSaleReviewDecision.reject_void,
          reviewed_by: actor.sub,
          reviewed_at: new Date(),
          review_reason: dto.reason,
          resolution_error: null,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException(
          'Only a pending sale review can be rejected',
        );
      }
      await tx.auditLog.create({
        data: {
          user_id: actor.sub,
          action: 'sale.review.rejected_local_reversal',
          entity: 'PosSaleReview',
          entity_id: review.id,
          meta: {
            sync_id: review.sync_id,
            terminal_id: review.terminal_id,
            terminal_sequence:
              review.terminal_sequence.toString(),
            origin_cashier_id: review.origin_cashier_id,
            shift_id: review.shift_id,
            reason: dto.reason,
            financial_settlement_confirmed: true,
          },
        },
      });
    });
    return this.get(id, actor);
  }
}
