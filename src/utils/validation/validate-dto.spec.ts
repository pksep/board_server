import { BadRequestException } from '@nestjs/common';
import { CreateBoardDto } from '../../modules/boards/dto/create-board.dto';
import { CreateProjectDto } from '../../modules/projects/dto/create-project.dto';
import { validateDto } from './validate-dto';

describe('validateDto', () => {
  it('проверяет внутренний вызов по тем же правилам DTO, что и HTTP', async () => {
    await expect(
      validateDto(CreateBoardDto, {
        title: 'План производства',
        startDate: 'завтра'
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('возвращает экземпляр DTO для корректных данных', async () => {
    const dto = await validateDto(CreateBoardDto, {
      title: 'План производства',
      startDate: '2026-08-21'
    });

    expect(dto).toBeInstanceOf(CreateBoardDto);
    expect(dto).toMatchObject({
      title: 'План производства',
      startDate: '2026-08-21'
    });
  });

  it('не пропускает некорректные идентификаторы связанных сущностей', async () => {
    await expect(
      validateDto(CreateProjectDto, {
        title: 'План производства',
        prefix: 'PRD',
        membersIds: [1, 0, 1]
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
