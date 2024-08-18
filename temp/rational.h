// rational.h

#define STRSIZE 80

typedef struct rationalnumber
{
  // '+'/'-', '0'-'9', '.', 121x'0'-'9'

  int sign;
  long long int num;
  long long int  denom;

  char str_form[STRSIZE];

} RATIONAL, RATIONALNUMBER, *RATIONALNUMBER_PTR, *RATIONAL_PTR;

extern RATIONALNUMBER zero;
extern void rationalnumber_print(RATIONALNUMBER_PTR x);

extern RATIONALNUMBER rationalnumber_fabs(RATIONALNUMBER src);

extern RATIONALNUMBER rationalnumber_neg(RATIONALNUMBER src);

extern void rationalnumber_add(RATIONALNUMBER_PTR dest,
  RATIONALNUMBER a, RATIONALNUMBER b);

extern void rationalnumber_init(RATIONALNUMBER_PTR xptr, 
      int sign, long long int num, long long int denom);

extern void rationalnumber_sub(RATIONALNUMBER_PTR dest,
  RATIONALNUMBER a, RATIONALNUMBER b);

extern int rationalnumber_is_zero(RATIONALNUMBER_PTR xptr);

extern int rationalnumber_is_negative(RATIONALNUMBER_PTR xptr);

extern int rationalnumber_is_positive(RATIONALNUMBER_PTR xptr);


//extern void rightshiftdigits(RATIONALNUMBER_PTR x);

//extern void leftshiftdigits(RATIONALNUMBER_PTR x);

//extern void rightnshiftdigits(RATIONALNUMBER_PTR x, int n);

//extern void leftnshiftdigits(RATIONALNUMBER_PTR x, int n);

extern int which_is_larger(RATIONALNUMBER a, RATIONALNUMBER b,
  RATIONALNUMBER_PTR smaller, RATIONALNUMBER_PTR larger );

extern void rationalnumber_mult(RATIONALNUMBER_PTR dest,
  RATIONALNUMBER a, RATIONALNUMBER b);

extern void rationalnumber_div(RATIONALNUMBER_PTR dest,
  RATIONALNUMBER a, RATIONALNUMBER b);

extern int rationalnumber_is_equal(RATIONALNUMBER_PTR a, 
          RATIONALNUMBER_PTR b);

extern int rationalnumber_is_greater(RATIONALNUMBER_PTR a, 
RATIONALNUMBER_PTR b);

extern int rationalnumber_is_less(RATIONALNUMBER_PTR a, 
 RATIONALNUMBER_PTR b);

extern void copy_rationalnumber(RATIONALNUMBER_PTR dest,
  RATIONALNUMBER a);

extern  void rationalnumber_assign_const(RATIONALNUMBER_PTR dest,
  char *a);

extern int rationalnumber_which_is_larger(RATIONALNUMBER a, RATIONALNUMBER b,
  RATIONALNUMBER_PTR *smaller, RATIONALNUMBER_PTR *rationalr );
