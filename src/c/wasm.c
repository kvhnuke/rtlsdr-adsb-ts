
#include <stdlib.h>
#include <emscripten.h>

extern void cb(unsigned char *);

int EMSCRIPTEN_KEEPALIVE sumArrayInt32(int *array, int length)
{
    int total = 0;

    for (int i = 0; i < length; ++i)
    {
        total += array[i];
    }
    unsigned char *abc = malloc(3);
    abc[0] = 1;
    abc[1] = 2;
    abc[2] = 3;
    cb(abc);
    return total;
}