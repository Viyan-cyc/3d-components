export const instanced_pars_vertex = /* glsl */`
#ifdef USE_INSTANCING_INDIRECT
  attribute uint instanceIndex;
  uniform highp sampler2D matricesTexture;

  mat4 getInstancedMatrix() {
    int size = textureSize( matricesTexture, 0 ).x;
    int j = int( instanceIndex ) * 4;
    int x = j % size;
    int y = j / size;
    vec4 v1 = texelFetch( matricesTexture, ivec2( x, y ), 0 );
    vec4 v2 = texelFetch( matricesTexture, ivec2( x + 1, y ), 0 );
    vec4 v3 = texelFetch( matricesTexture, ivec2( x + 2, y ), 0 );
    vec4 v4 = texelFetch( matricesTexture, ivec2( x + 3, y ), 0 );
    return mat4( v1, v2, v3, v4 );
  }
#endif
`;

export const instanced_vertex = /* glsl */`
#ifdef USE_INSTANCING_INDIRECT
  mat4 instanceMatrix = getInstancedMatrix();

  #ifdef USE_INSTANCING_COLOR_INDIRECT
    vColor *= getColorTexture();
  #endif
#endif
`;

export const instanced_color_pars_vertex = /* glsl */`
#ifdef USE_INSTANCING_COLOR_INDIRECT
  uniform highp sampler2D colorsTexture;

  vec4 getColorTexture() {
    int size = textureSize( colorsTexture, 0 ).x;
    int j = int( instanceIndex );
    int x = j % size;
    int y = j / size;
    return texelFetch( colorsTexture, ivec2( x, y ), 0 );
  }
#endif
`;

export const instanced_color_vertex = /* glsl */`
#ifdef USE_INSTANCING_COLOR_INDIRECT
  #ifdef USE_VERTEX_COLOR
    vColor = vec4( color );
  #else
    vColor = vec4( 1.0 );
  #endif
#endif
`;

export const instanced_skinning_pars_vertex = /* glsl */`
#ifdef USE_SKINNING
  uniform mat4 bindMatrix;
  uniform mat4 bindMatrixInverse;
  uniform highp sampler2D boneTexture;

  #ifdef USE_INSTANCING_SKINNING
    uniform int bonesPerInstance;
  #endif

  mat4 getBoneMatrix( const in float i ) {
    int size = textureSize( boneTexture, 0 ).x;

    #ifdef USE_INSTANCING_SKINNING
      int j = ( bonesPerInstance * int( instanceIndex ) + int( i ) ) * 4;
    #else
      int j = int( i ) * 4;
    #endif

    int x = j % size;
    int y = j / size;
    vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
    vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
    vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
    vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
    return mat4( v1, v2, v3, v4 );
  }
#endif
`;
