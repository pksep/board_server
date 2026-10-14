import { validate } from 'class-validator';
import { CreateBoardDto } from './create-board.dto';
import { UpdateBoardDto } from './update-board.dto';

describe.each([CreateBoardDto, UpdateBoardDto])(
  '%s board members validation',
  Dto => {
    it.each([
      { membersIds: undefined },
      { membersIds: [] },
      { membersIds: [1, 2] }
    ])(
      'accepts omitted, empty or unique positive IDs: %j',
      async ({ membersIds }) => {
        const dto = Object.assign(new Dto(), { title: 'Board', membersIds });

        expect(await validate(dto)).toHaveLength(0);
      }
    );

    it.each([
      { membersIds: null },
      { membersIds: '1' },
      { membersIds: [1, 1] },
      { membersIds: [0] },
      { membersIds: [-1] },
      { membersIds: [1.5] },
      { membersIds: ['1'] }
    ])('rejects invalid members: %j', async ({ membersIds }) => {
      const dto = Object.assign(new Dto(), { title: 'Board', membersIds });

      expect(await validate(dto)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ property: 'membersIds' })
        ])
      );
    });
  }
);
