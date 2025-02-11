const Composer = require('telegraf/composer')
const EmojiDbLib = require('emoji-db')
const {
  keyboardUpdate
} = require('../helpers')

const emojiDb = new EmojiDbLib({ useDefaultDb: true })

const composer = new Composer()

composer.on('channel_post', async (ctx, next) => {
  if (ctx.session.channelInfo.settings.type === 'never') return next()
  if (ctx.session.channelInfo.settings.type === 'one') ctx.session.channelInfo.settings.type = 'never'

  const post = new ctx.db.Post()

  const votesRateArray = []
  const votesKeyboardArray = []

  let emojis, newText
  let messageType = 'keyboard'

  if (ctx.channelPost.text || ctx.channelPost.caption) {
    const text = ctx.channelPost.text || ctx.channelPost.caption
    const textLines = text.split('\n')
    const lastLine = textLines.pop()

    if (lastLine[0] === '!') {
      const emojisFromLine = emojiDb.searchFromText({ input: lastLine, fixCodePoints: true })
      if (emojisFromLine.length > 0) emojis = emojisFromLine

      newText = textLines.join('\n')

      if (ctx.channelPost.text) messageType = 'text'
      else messageType = 'media'
    }
  }

  if (!emojis && ctx.session.channelInfo.settings.type === 'request') return next()
  if (!emojis) emojis = emojiDb.searchFromText({ input: ctx.session.channelInfo.settings.emojis, fixCodePoints: true })

  emojis.forEach(data => {
    votesRateArray.push({
      name: data.emoji,
      vote: []
    })
    votesKeyboardArray.push({
      text: data.emoji,
      callback_data: `rate:${data.emoji}`
    })
  })

  post.channel = ctx.session.channelInfo
  post.channelMessageId = ctx.channelPost.message_id
  post.rate = {
    votes: votesRateArray,
    score: 0
  }
  post.keyboard = post.channel.settings.keyboard

  if (ctx.session.channelInfo.settings.commentsType === 'never') post.commentsEnable = false
  if (ctx.session.channelInfo.settings.commentsType === 'one') ctx.session.channelInfo.settings.commentsType = 'never'

  await post.save()

  const updateResult = await keyboardUpdate(post.channel.channelId, post.channelMessageId, {
    type: messageType,
    text: newText
  })

  if (updateResult.error && updateResult.error.code === 400 && !ctx.channelPost.forward_from_message_id) {
    const botMember = await ctx.tg.getChatMember(post.channel.channelId, ctx.botInfo.id)
    if (botMember.can_be_edited === false) {
      for (const admin of post.channel.administrators) {
        const adminUser = await ctx.db.User.findOne({ telegramId: admin.user })

        if (adminUser) {
          ctx.i18n.locale(adminUser.settings.locale)
          await ctx.tg.sendMessage(admin.user, ctx.i18n.t('error.cant_edited', {
            postLink: `https://t.me/c/${ctx.chat.id.toString().substr(4)}/${ctx.channelPost.message_id}`
          }), {
            parse_mode: 'HTML'
          }).catch(() => {})
        }
      }
    }
  }
})

composer.action('post:wait', async (ctx, next) => {
  ctx.state.answerCbQuery = [ctx.i18n.t('wait'), true]
})

composer.on('message', async (ctx, next) => {
  if (ctx.from.id === 777000 && ctx.message.forward_from_message_id) {
    const channel = await ctx.db.Channel.findOne({ channelId: ctx.message.forward_from_chat.id })
    const post = await ctx.db.Post.findOne({ channel, channelMessageId: ctx.message.forward_from_message_id })

    if (!post || post.commentsEnable === false) return next()

    post.groupMessageId = ctx.message.message_id
    await post.save()

    if (channel.groupId !== ctx.message.chat.id) {
      await ctx.db.Channel.findByIdAndUpdate(channel, {
        groupId: ctx.message.chat.id
      })
    }

    const votesKeyboardArray = []

    post.rate.votes.forEach(react => {
      votesKeyboardArray.push({
        text: react.name,
        callback_data: `rate:${react.name}`
      })
    })

    votesKeyboardArray.push({
      text: '💬',
      url: `https://t.me/c/${ctx.message.chat.id.toString().substr(4)}/${channel.settings.showStart === 'top' ? 1 : 1000000}?thread=${ctx.message.message_id}`
    })

    await keyboardUpdate(channel.channelId, post.channelMessageId)
  } else {
    return next()
  }
})

module.exports = composer
