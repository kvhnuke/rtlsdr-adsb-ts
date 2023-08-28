#include "mode-s.h"
#include <assert.h>
#include <node_api.h>
#include <stdio.h>

static void Demodulate(napi_env env, napi_callback_info info)
{
    napi_status status;

    size_t argc = 3;
    napi_value args[3];
    status = napi_get_cb_info(env, info, &argc, args, NULL, NULL);
    assert(status == napi_ok);
    if (argc < 3)
    {
        napi_throw_type_error(env, NULL, "Wrong number of arguments");
        return;
    }
    napi_valuetype bufferValue;
    status = napi_typeof(env, args[0], &bufferValue);
    assert(status == napi_ok);
    napi_valuetype bufferValueLen;
    status = napi_typeof(env, args[1], &bufferValueLen);
    assert(status == napi_ok);

    napi_value cb = args[2];

    napi_value global;
    status = napi_get_global(env, &global);
    assert(status == napi_ok);

    bool isBufferType;
    status = napi_is_buffer(env, args[0], &isBufferType);
    assert(status == napi_ok);
    if (!isBufferType)
    {
        napi_throw_type_error(env, NULL, "Invalid arguments");
        return;
    }

    size_t size = 0;
    uint32_t data_len;
    status = napi_get_value_uint32(env, args[1], &data_len);
    assert(status == napi_ok);
    unsigned char *source = malloc(data_len);
    assert(source != NULL);
    status = napi_get_buffer_info(env, args[0], (void **)&source, &size);
    if (size != data_len)
    {
        napi_throw_type_error(env, NULL, "Buffer length does not match");
        return;
    }
    assert(status == napi_ok);

    mode_s_t state;
    uint16_t *mag = malloc((data_len / 2) * sizeof(uint16_t));

    mode_s_init(&state);
    mode_s_compute_magnitude_vector(&source[0], mag, data_len);

    void on_msg(mode_s_t * self, struct mode_s_msg * mm)
    {
        size_t msgLength = mm->msgbits / 8;
        napi_value argv;
        status = napi_create_buffer_copy(env, msgLength, mm->msg, NULL, &argv);
        assert(status == napi_ok);
        napi_value result;
        status = napi_call_function(env, global, cb, 1, &argv, &result);
        assert(status == napi_ok);
    }
    mode_s_detect(&state, mag, data_len / 2, on_msg);
}

#define DECLARE_NAPI_METHOD(name, func)         \
    {                                           \
        name, 0, func, 0, 0, 0, napi_default, 0 \
    }

napi_value Init(napi_env env, napi_value exports)
{
    napi_status status;
    napi_property_descriptor addDescriptor = DECLARE_NAPI_METHOD("Demodulate", Demodulate);
    status = napi_define_properties(env, exports, 1, &addDescriptor);
    assert(status == napi_ok);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)