#ifndef LED_H
#define LED_H
/* LED_UNKNOWN 故意没有任何引用：AST 阶段只收代码里用到的枚举常量，没被引用的成员
   只能靠 hover 兜底取值，所以它守着「hover 必须在 clangd 关掉之前问」这条。 */
typedef enum { LED_OFF = 0, LED_ON, LED_FAULT, LED_UNKNOWN } led_state_t;
typedef struct { led_state_t state; unsigned since; } led_ctx_t;
void led_init(void);
void led_task(void);
led_state_t led_state(void);
#endif
