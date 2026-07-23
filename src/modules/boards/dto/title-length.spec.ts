import { validate } from 'class-validator';
import { CreateBoardDto } from './create-board.dto';
import { UpdateBoardDto } from './update-board.dto';
import { CreateTaskDto } from '../../tasks/dto/create-task.dto';
import { UpdateTaskDto } from '../../tasks/dto/update-task.dto';

describe.each([
  ['CreateBoardDto', CreateBoardDto],
  ['UpdateBoardDto', UpdateBoardDto],
  ['CreateTaskDto', CreateTaskDto],
  ['UpdateTaskDto', UpdateTaskDto]
])('%s title length validation', (_, DtoClass) => {
  it('accepts a title containing 255 characters', async () => {
    const dto = Object.assign(new DtoClass(), { title: 'a'.repeat(255) });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects a title containing more than 255 characters', async () => {
    const dto = Object.assign(new DtoClass(), { title: 'a'.repeat(256) });

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'title',
          constraints: expect.objectContaining({
            maxLength: expect.any(String)
          })
        })
      ])
    );
  });
});
